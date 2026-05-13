import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../errors';
import { type AuthEnv, authMiddleware, requireScope } from '../middleware';
import { modelService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Public SSE route - emits an opaque re-fetch trigger only, no model data. The
 *  payload used to be the full installation map, which would have leaked the model
 *  inventory to anyone hitting the URL. The client receives the ping and goes through
 *  the protected /installed endpoint, where authMiddleware enforces the boundary. */
const modelSseRoutes = new Hono().get('/events', async (c) => {
  return streamSSE(c, async (stream) => {
    const removeListener = modelService.addModelChangeListener(async () => {
      try {
        await stream.writeSSE({ event: 'change', data: '1' });
      } catch (err) {
        // SSE write failed -> client disconnected. Drop ourselves; transient backend
        // errors no longer reach this listener (we don't read state here).
        console.warn('[models/events] write failed, unsubscribing', err);
        removeListener();
      }
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
  .get('/catalog', requireScope('models:read'), async (c) => c.json(await modelService.getFullCatalog(c.get('userId'))))
  .get('/installed', requireScope('models:read'), async (c) => {
    const catalog = await modelService.getFullCatalog(c.get('userId'));
    return c.json(await modelService.getInstallations(catalog));
  })
  .get('/:id/voices', requireScope('models:read'), zValidator('param', idParamSchema), async (c) => c.json(await modelService.listPresetVoicesFor(c.req.valid('param').id, c.get('userId'))))
  .delete('/:id', requireScope('models:write'), zValidator('param', idParamSchema), async (c) => {
    await modelService.removeModelFiles(c.req.valid('param').id, c.req.query('serverId'));
    return c.body(null, 204);
  })
  .post('/:id/pull', requireScope('models:write'), zValidator('param', idParamSchema), zValidator('json', z.object({ serverIds: z.array(z.string().min(1)).optional() })), async (c) => {
    const userId = c.get('userId');
    const fullCatalog = await modelService.getFullCatalog(userId);
    const catalog = fullCatalog.find((m) => m.id === c.req.valid('param').id);
    if (!catalog) {
      throw new NotFoundError('model.notInCatalog', `Model "${c.req.valid('param').id}" not found in catalog`);
    }
    const { jobIds, alreadyRunning } = await modelService.startModelDownload(catalog, c.req.valid('json').serverIds);
    return c.json({ jobIds }, alreadyRunning ? 200 : 202);
  })
  .post('/piper/import', requireScope('models:write'), async (c) => {
    const formData = await c.req.formData();
    // FormData entries can be string or File. A `name=...&onnx=foo` payload would
    // pass an `as File` cast and only blow up when we try to read its bytes,
    // turning a malformed client request into a 500. Validate up front.
    const onnxFile = formData.get('onnx');
    const configFile = formData.get('config');
    const nameRaw = formData.get('name');
    if (!(onnxFile instanceof File) || !(configFile instanceof File) || typeof nameRaw !== 'string') {
      throw new BadRequestError('model.piperFieldsRequired', 'Fields "onnx", "config", and "name" are required');
    }
    // serverIds is sent as a JSON array string from the dialog; absent = all online.
    // Any non-empty value that fails to parse as a string[] is rejected - silently
    // falling back to "all online servers" turns a malformed payload into an unintended
    // fan-out write.
    const serverIdsRaw = formData.get('serverIds');
    let serverIds: string[] | undefined;
    if (typeof serverIdsRaw === 'string' && serverIdsRaw.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(serverIdsRaw);
      } catch {
        throw new BadRequestError('model.serverIdsNotJson', 'serverIds must be a JSON array of strings');
      }
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string' && v.length > 0)) {
        throw new BadRequestError('model.serverIdsInvalid', 'serverIds must be a JSON array of non-empty strings');
      }
      serverIds = parsed as string[];
    }

    const { slug, jobIds } = await modelService.importPiperFromUpload({ name: nameRaw, onnxFile, configFile, serverIds });
    return c.json({ id: slug, jobIds }, 202);
  })
  .get('/:id/export', requireScope('models:read'), zValidator('param', idParamSchema), async (c) => {
    const { id: modelId } = c.req.valid('param');
    const upstream = await modelService.exportCustomModel(modelId);
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="piper-${modelId}.zip"`,
      },
    });
  });

export const modelRoutes = new Hono().route('/', modelSseRoutes).route('/', modelProtectedRoutes);
