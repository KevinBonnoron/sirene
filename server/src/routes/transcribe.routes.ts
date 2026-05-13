import { Hono } from 'hono';
import { BadRequestError } from '../errors';
import { type AuthEnv, requireScope } from '../middleware';
import { transcribeService } from '../services';

export const transcribeRoutes = new Hono<AuthEnv>().post('/', requireScope('transcribe'), async (c) => {
  const formData = await c.req.formData();
  const audio = formData.get('audio');
  if (!(audio instanceof File)) {
    throw new BadRequestError('transcribe.audioRequired', 'audio file is required');
  }
  return c.json(await transcribeService.transcribe(audio));
});
