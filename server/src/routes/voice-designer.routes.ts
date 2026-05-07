import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { mapServiceError, voiceDesignerService } from '../services';

const previewSchema = z.object({
  modelId: z.string().min(1),
  text: z.string().min(1),
  instructText: z.string().min(1),
  gender: z.enum(['male', 'female']).default('male'),
  language: z.string().default('en'),
});

export const voiceDesignerRoutes = new Hono<AuthEnv>()
  .post('/preview', zValidator('json', previewSchema), async (c) => {
    try {
      const audio = await voiceDesignerService.preview(c.req.valid('json'));
      return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } });
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .post('/save', async (c) => {
    const formData = await c.req.formData();
    const name = (formData.get('name') as string | null)?.trim() ?? '';
    const audio = formData.get('audio');
    if (!name || !(audio instanceof File)) {
      return c.json({ message: 'name and audio are required' }, 400);
    }

    try {
      const voice = await voiceDesignerService.save({
        userId: c.get('userId'),
        name,
        description: (formData.get('description') as string | null) ?? undefined,
        language: (formData.get('language') as string | null) ?? undefined,
        model: (formData.get('model') as string | null) ?? undefined,
        transcript: (formData.get('transcript') as string | null) ?? undefined,
        audio,
      });
      return c.json(voice, 201);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });
