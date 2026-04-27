import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { listElevenLabsVoices } from '../lib/elevenlabs-client';
import { fetchModelExport, importPiperModelToInference } from '../lib/inference-client';
import { NoInferenceServerError, pickServerUrl } from '../lib/inference-router';
import { jobStore, newJobId } from '../lib/jobs';
import { listOpenAIVoices } from '../lib/openai-tts-client';
import { modelsCatalog } from '../manifest/models.manifest';
import { type AuthEnv, authMiddleware } from '../middleware';
import { modelService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Public SSE routes — EventSource cannot send auth headers. */
const modelSseRoutes = new Hono().get('/events', async (c) => {
  return streamSSE(c, async (stream) => {
    const removeListener = modelService.addModelChangeListener(async () => {
      const catalog = await modelService.getFullCatalog();
      const installations = await modelService.getInstallations(catalog);
      await stream.writeSSE({ event: 'change', data: JSON.stringify(installations) });
    });

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => {
        removeListener();
        resolve();
      });
    });
  });
});

const modelProtectedRoutes = new Hono<AuthEnv>()
  .use(authMiddleware)

  .get('/catalog', async (c) => {
    const userId = c.get('userId');
    const catalog = await modelService.getFullCatalog(userId);
    return c.json(catalog);
  })

  .get('/installed', async (c) => {
    const userId = c.get('userId');
    const catalog = await modelService.getFullCatalog(userId);
    const installations = await modelService.getInstallations(catalog);
    return c.json(installations);
  })

  .get('/:id/voices', zValidator('param', idParamSchema), async (c) => {
    const userId = c.get('userId');
    const { id: modelId } = c.req.valid('param');
    const fullCatalog = await modelService.getFullCatalog(userId);
    const catalog = fullCatalog.find((m) => m.id === modelId);
    if (!catalog) {
      return c.json({ message: 'Model not found' }, 404);
    }

    if (catalog.backend === 'elevenlabs') {
      try {
        const voices = await listElevenLabsVoices(userId);
        return c.json(voices);
      } catch (e) {
        return c.json({ message: e instanceof Error ? e.message : 'Failed to fetch voices' }, 502);
      }
    }

    if (catalog.backend === 'openai') {
      return c.json(listOpenAIVoices());
    }

    return c.json(catalog.presetVoices ?? []);
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');
    await modelService.removeModelFiles(modelId);
    return c.body(null, 204);
  })

  .post('/:id/pull', zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');
    const userId = c.get('userId');

    const fullCatalog = await modelService.getFullCatalog(userId);
    const catalog = fullCatalog.find((m) => m.id === modelId);
    if (!catalog) {
      return c.json({ message: 'Model not found in catalog' }, 404);
    }

    if (await modelService.isModelInstalled(catalog)) {
      return c.json({ message: 'Model already installed' }, 400);
    }

    const { jobId, alreadyRunning } = modelService.startModelDownload(catalog);
    return c.json({ jobId }, alreadyRunning ? 200 : 202);
  })

  .post('/piper/import', async (c) => {
    const formData = await c.req.formData();
    const configFile = formData.get('config') as File | null;
    const name = (formData.get('name') as string)?.trim();

    if (!formData.get('onnx') || !configFile || !name) {
      return c.json({ message: 'Fields "onnx", "config", and "name" are required' }, 400);
    }

    // Check catalog conflict before hitting inference
    const configText = await configFile.text();
    let configData: Record<string, unknown>;
    try {
      configData = JSON.parse(configText);
    } catch {
      return c.json({ message: 'Config file is not valid JSON' }, 400);
    }

    if (!configData.espeak || !configData.phoneme_id_map) {
      return c.json({ message: 'Config must contain "espeak" and "phoneme_id_map" fields (Piper format)' }, 400);
    }

    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    const espeakVoice = (configData.espeak as Record<string, string>).voice ?? '';
    const [langPart = '', regionPart] = espeakVoice.split('-');
    const locale = regionPart ? `${langPart.toLowerCase()}_${regionPart.toUpperCase()}` : langPart.toLowerCase();
    const sampleRate = (configData.audio as Record<string, number> | undefined)?.sample_rate ?? 22050;
    const quality = sampleRate <= 16000 ? 'low' : 'medium';
    const speakerSlug = name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    if (!speakerSlug) {
      return c.json({ message: 'Invalid model name' }, 400);
    }
    const slug = `piper-${locale}-${speakerSlug}-${quality}`;

    if (catalogIds.has(slug)) {
      return c.json({ message: `Name "${slug}" conflicts with an existing catalog model` }, 409);
    }

    let baseUrl: string;
    try {
      baseUrl = await pickServerUrl();
    } catch (err) {
      if (err instanceof NoInferenceServerError) {
        return c.json({ message: err.message }, 503);
      }
      throw err;
    }

    const jobId = newJobId();
    jobStore.start({ id: jobId, type: 'model_import', label: `Importing ${name}`, target: slug });
    try {
      const result = await importPiperModelToInference(baseUrl, formData);
      jobStore.complete(jobId);
      return c.json(result, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      jobStore.fail(jobId, message);
      const status = (err as { status?: number }).status === 409 ? 409 : 400;
      return c.json({ message }, status);
    }
  })

  .get('/:id/export', zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');

    const customs = await modelService.scanCustomModels();
    if (!customs.find((m) => m.id === modelId)) {
      return c.json({ message: 'Custom model not found' }, 404);
    }

    let baseUrl: string;
    try {
      baseUrl = await pickServerUrl();
    } catch (err) {
      if (err instanceof NoInferenceServerError) {
        return c.json({ message: err.message }, 503);
      }
      throw err;
    }

    const inferenceResponse = await fetchModelExport(baseUrl, modelId);
    if (!inferenceResponse.ok) {
      return c.json({ message: 'Export failed' }, 502);
    }

    return new Response(inferenceResponse.body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="piper-${modelId}.zip"`,
      },
    });
  });

export const modelRoutes = new Hono().route('/', modelSseRoutes).route('/', modelProtectedRoutes);
