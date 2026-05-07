import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { mapServiceError, voiceService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

export const voiceRoutes = new Hono<AuthEnv>()
  .post('/import', async (c) => {
    const formData = await c.req.formData();
    const zipFile = formData.get('file');
    if (!(zipFile instanceof File)) {
      return c.json({ message: 'A .zip file is required' }, 400);
    }

    try {
      const voice = await voiceService.importFromZip(c.get('userId'), await zipFile.arrayBuffer());
      return c.json(voice, 201);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .get('', async (c) => {
    return c.json(await voiceService.listForUser(c.get('userId')));
  })

  .get('/:id', zValidator('param', idParamSchema), async (c) => {
    try {
      return c.json(await voiceService.getById(c.req.valid('param').id));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .post('', async (c) => {
    const formData = await c.req.formData();
    const voice = await voiceService.create(c.get('userId'), formData);
    return c.json(voice, 201);
  })

  .put('/:id', zValidator('param', idParamSchema), async (c) => {
    const formData = await c.req.formData();
    return c.json(await voiceService.update(c.req.valid('param').id, formData));
  })

  .get('/:id/export', zValidator('param', idParamSchema), async (c) => {
    try {
      const { buffer, filename } = await voiceService.exportToZip(c.req.valid('param').id);
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length),
        },
      });
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .get('/:id/samples', zValidator('param', idParamSchema), async (c) => {
    return c.json(await voiceService.listSamples(c.req.valid('param').id));
  })

  .post('/:id/samples', zValidator('param', idParamSchema), async (c) => {
    const formData = await c.req.formData();
    const audio = formData.get('audio');
    if (!(audio instanceof File)) {
      return c.json({ message: 'audio file is required' }, 400);
    }
    const transcript = (formData.get('transcript') as string | null) ?? '';
    try {
      const sample = await voiceService.addSample(c.req.valid('param').id, audio, transcript);
      return c.json(sample, 201);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });
