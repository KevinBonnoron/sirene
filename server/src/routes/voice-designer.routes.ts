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
    // Each field can come back as string | File | null. Casting File-valued
    // text fields would silently forward Files (or throw on .trim()), so we
    // narrow each one explicitly and 400 on any type mismatch.
    const name = readTextField(formData, 'name')?.trim();
    const audio = formData.get('audio');
    if (!name || !(audio instanceof File)) {
      return c.json({ message: 'name and audio are required' }, 400);
    }
    const description = readTextField(formData, 'description');
    const language = readTextField(formData, 'language');
    const model = readTextField(formData, 'model');
    const transcript = readTextField(formData, 'transcript');
    if (description === null || language === null || model === null || transcript === null) {
      return c.json({ message: 'description, language, model and transcript must be text fields' }, 400);
    }

    try {
      const voice = await voiceDesignerService.save({
        userId: c.get('userId'),
        name,
        description,
        language,
        model,
        transcript,
        audio,
      });
      return c.json(voice, 201);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });

/** Returns the field as a string, `undefined` when absent, or `null` on a
 *  type mismatch (the field came back as a File). The caller decides how to
 *  reject the mismatch case. */
function readTextField(form: FormData, name: string): string | undefined | null {
  const value = form.get(name);
  if (value === null) {
    return undefined;
  }
  return typeof value === 'string' ? value : null;
}
