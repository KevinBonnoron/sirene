import { Hono } from 'hono';
import { mapServiceError, transcribeService } from '../services';

export const transcribeRoutes = new Hono().post('/', async (c) => {
  const formData = await c.req.formData();
  const audio = formData.get('audio');
  if (!(audio instanceof File)) {
    return c.json({ message: 'audio file is required' }, 400);
  }

  try {
    const result = await transcribeService.transcribe(audio);
    return c.json(result);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const { status, body } = mapServiceError(err);
    return c.json(body, isTimeout ? 504 : status);
  }
});
