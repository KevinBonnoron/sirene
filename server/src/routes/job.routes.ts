import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { jobStore } from '../lib/jobs';
import { type AuthEnv, authMiddleware } from '../middleware';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Public SSE/list — EventSource cannot send auth headers, and jobs reflect global server state. */
const jobPublicRoutes = new Hono()
  .get('/', (c) => c.json(jobStore.list()))

  .get('/stream', async (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'snapshot', data: JSON.stringify(jobStore.list()) });

      const unsubscribe = jobStore.subscribe(async (update) => {
        if (update.type === 'job') {
          await stream.writeSSE({ event: 'job', data: JSON.stringify(update.job) });
        } else {
          await stream.writeSSE({ event: 'remove', data: JSON.stringify({ id: update.id }) });
        }
      });

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          unsubscribe();
          resolve();
        });
      });
    }),
  );

const jobProtectedRoutes = new Hono<AuthEnv>().use(authMiddleware).delete('/:id', zValidator('param', idParamSchema), (c) => {
  const { id } = c.req.valid('param');
  const dismissed = jobStore.dismiss(id);
  if (!dismissed) {
    return c.json({ message: 'Job not found or still running' }, 409);
  }
  return c.body(null, 204);
});

export const jobRoutes = new Hono().route('/', jobPublicRoutes).route('/', jobProtectedRoutes);
