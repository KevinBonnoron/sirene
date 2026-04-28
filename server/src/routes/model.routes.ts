import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { listElevenLabsVoices } from '../lib/elevenlabs-client';
import { fetchModelExport } from '../lib/inference-client';
import { NoInferenceServerError, pickTarget } from '../lib/inference-router';
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
    const serverId = c.req.query('serverId');
    try {
      await modelService.removeModelFiles(modelId, serverId);
      return c.body(null, 204);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove';
      return c.json({ message }, 502);
    }
  })

  .post('/:id/pull', zValidator('param', idParamSchema), zValidator('json', z.object({ serverIds: z.array(z.string().min(1)).optional() })), async (c) => {
    const { id: modelId } = c.req.valid('param');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const fullCatalog = await modelService.getFullCatalog(userId);
    const catalog = fullCatalog.find((m) => m.id === modelId);
    if (!catalog) {
      return c.json({ message: 'Model not found in catalog' }, 404);
    }

    try {
      const { jobIds, alreadyRunning } = await modelService.startModelDownload(catalog, body?.serverIds);
      return c.json({ jobIds }, alreadyRunning ? 200 : 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start download';
      return c.json({ message }, 503);
    }
  })

  .post('/piper/import', async (c) => {
    const formData = await c.req.formData();
    const onnxFile = formData.get('onnx') as File | null;
    const configFile = formData.get('config') as File | null;
    const name = (formData.get('name') as string)?.trim();
    // serverIds is sent as a JSON array string from the dialog; absent = all online.
    const serverIdsRaw = formData.get('serverIds');
    let serverIds: string[] | undefined;
    if (typeof serverIdsRaw === 'string' && serverIdsRaw.length > 0) {
      try {
        const parsed = JSON.parse(serverIdsRaw);
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
          serverIds = parsed;
        }
      } catch {
        return c.json({ message: 'serverIds must be a JSON array of strings' }, 400);
      }
    }

    if (!onnxFile || !configFile || !name) {
      return c.json({ message: 'Fields "onnx", "config", and "name" are required' }, 400);
    }

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

    // Read the file bytes once on Hono so we can fan out to multiple inference servers
    // without re-reading from the user's upload (which is a one-shot stream).
    const onnxBytes = await onnxFile.arrayBuffer();
    const configBytes = new TextEncoder().encode(configText).buffer as ArrayBuffer;

    try {
      const { jobIds } = await modelService.startPiperImport({
        slug,
        name,
        onnxBytes,
        onnxName: onnxFile.name || `${speakerSlug}.onnx`,
        onnxType: onnxFile.type || 'application/octet-stream',
        configBytes,
        configName: configFile.name || `${speakerSlug}.onnx.json`,
        configType: configFile.type || 'application/json',
        serverIds,
      });
      return c.json({ id: slug, jobIds }, 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      const status = err instanceof NoInferenceServerError ? 503 : 400;
      return c.json({ message }, status);
    }
  })

  .get('/:id/export', zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');

    const customs = await modelService.scanCustomModels();
    if (!customs.find((m) => m.id === modelId)) {
      return c.json({ message: 'Custom model not found' }, 404);
    }

    let exportTarget: { url: string; authToken?: string };
    try {
      exportTarget = await pickTarget({ requireModel: modelId });
    } catch (err) {
      if (err instanceof NoInferenceServerError) {
        return c.json({ message: err.message }, 503);
      }
      throw err;
    }

    const inferenceResponse = await fetchModelExport(exportTarget, modelId);
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
