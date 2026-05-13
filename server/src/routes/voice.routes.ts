import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { BadRequestError } from '../errors';
import { type AuthEnv, requireScope } from '../middleware';
import { voiceService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

export const voiceRoutes = new Hono<AuthEnv>()
  .post('/import', requireScope('voices:write'), async (c) => {
    const formData = await c.req.formData();
    const zipFile = formData.get('file');
    if (!(zipFile instanceof File) || !zipFile.name.toLowerCase().endsWith('.zip')) {
      throw new BadRequestError('voice.zipRequired', 'A .zip file is required');
    }
    const voice = await voiceService.importFromZip(c.get('userId'), await zipFile.arrayBuffer());
    return c.json(voice, 201);
  })

  .get('', requireScope('voices:read'), async (c) => c.json(await voiceService.listForUser(c.get('userId'))))
  .get('/:id', requireScope('voices:read'), zValidator('param', idParamSchema), async (c) => c.json(await voiceService.getById(c.req.valid('param').id, c.get('userId'))))

  .post('', requireScope('voices:write'), async (c) => {
    const formData = await c.req.formData();
    const voice = await voiceService.create(c.get('userId'), formData);
    return c.json(voice, 201);
  })

  .put('/:id', requireScope('voices:write'), zValidator('param', idParamSchema), async (c) => {
    const formData = await c.req.formData();
    return c.json(await voiceService.update(c.req.valid('param').id, c.get('userId'), formData));
  })

  .get('/:id/export', requireScope('voices:read'), zValidator('param', idParamSchema), async (c) => {
    const { buffer, filename } = await voiceService.exportToZip(c.req.valid('param').id, c.get('userId'));
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '_')}"`,
        'Content-Length': String(buffer.length),
      },
    });
  })

  .get('/:id/samples', requireScope('voices:read'), zValidator('param', idParamSchema), async (c) => c.json(await voiceService.listSamples(c.req.valid('param').id, c.get('userId'))))

  .post('/:id/samples', requireScope('voices:write'), zValidator('param', idParamSchema), async (c) => {
    const formData = await c.req.formData();
    const audio = formData.get('audio');
    if (!(audio instanceof File)) {
      throw new BadRequestError('voice.audioRequired', 'An audio file is required');
    }
    const transcript = (formData.get('transcript') as string | null) ?? '';
    const sample = await voiceService.addSample(c.req.valid('param').id, c.get('userId'), audio, transcript);
    return c.json(sample, 201);
  });
