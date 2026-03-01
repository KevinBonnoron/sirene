import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import JSZip from 'jszip';
import { z } from 'zod';
import { config } from '../lib/config';
import { listElevenLabsVoices } from '../lib/elevenlabs-client';
import { listOpenAIVoices } from '../lib/openai-tts-client';
import { modelsCatalog } from '../manifest/models.manifest';
import type { AuthEnv } from '../middleware';
import { modelService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Public SSE routes — mounted before auth middleware since EventSource cannot send headers. */
export const modelSseRoutes = new Hono()

  .get('/:id/pull', zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');

    const fullCatalog = await modelService.getFullCatalog();
    const catalog = fullCatalog.find((m) => m.id === modelId);
    if (!catalog) {
      return c.json({ message: 'Model not found in catalog' }, 404);
    }

    if (await modelService.isModelInstalled(catalog)) {
      return c.json({ message: 'Model already installed' }, 400);
    }

    if (modelService.getDownloadState(modelId)) {
      return c.json({ message: 'Model is already being pulled' }, 409);
    }

    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        modelService.downloadModel({
          catalog,
          onProgress: (progress) => {
            stream.writeSSE({ event: 'progress', data: JSON.stringify({ progress }) });
          },
          onComplete: () => {
            stream.writeSSE({ event: 'complete', data: JSON.stringify({}) });
            resolve();
          },
          onError: (message) => {
            stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
            resolve();
          },
        });
      });
    });
  })

  .get('/events', async (c) => {
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

export const modelRoutes = new Hono<AuthEnv>()

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

  .post('/piper/import', async (c) => {
    const formData = await c.req.formData();
    const onnxFile = formData.get('onnx') as File | null;
    const configFile = formData.get('config') as File | null;
    const name = (formData.get('name') as string)?.trim();

    if (!onnxFile || !configFile || !name) {
      return c.json({ message: 'Fields "onnx", "config", and "name" are required' }, 400);
    }

    // Validate config JSON has required Piper fields
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

    // Build a proper Piper slug: piper-{locale}-{name}-{quality}
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

    // Check for conflicts with existing catalog or custom models
    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    if (catalogIds.has(slug)) {
      return c.json({ message: `Name "${slug}" conflicts with an existing catalog model` }, 409);
    }

    const modelDir = join(config.modelsPath, slug);
    try {
      await readdir(modelDir);
      return c.json({ message: `A model directory "${slug}" already exists` }, 409);
    } catch {
      // Directory doesn't exist — good
    }

    // Save files to data/models/<slug>/
    await mkdir(modelDir, { recursive: true });

    const onnxName = onnxFile.name.endsWith('.onnx') ? onnxFile.name : `${speakerSlug}.onnx`;
    const configName = `${onnxName}.json`;

    await Bun.write(join(modelDir, onnxName), await onnxFile.arrayBuffer());
    await Bun.write(join(modelDir, configName), configText);

    return c.json({ id: slug, message: 'Piper model imported' }, 201);
  })

  .get('/:id/export', zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');

    // Only allow export of custom models (not in catalog)
    const customs = await modelService.scanCustomModels();
    const model = customs.find((m) => m.id === modelId);
    if (!model) {
      return c.json({ message: 'Custom model not found' }, 404);
    }

    const modelDir = join(config.modelsPath, modelId);
    const zip = new JSZip();

    // Add all files in the model directory to the zip
    async function addDirToZip(dir: string, zipFolder: JSZip) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          addDirToZip(fullPath, zipFolder.folder(entry.name) as JSZip);
        } else {
          const content = await readFile(fullPath);
          zipFolder.file(entry.name, content);
        }
      }
    }

    await addDirToZip(modelDir, zip);

    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
    const downloadName = `piper-${modelId}.zip`;

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  });
