import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { jobStore } from '../lib/jobs';
import type { AuthEnv } from '../middleware';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Jobs reflect global server state and may include user-supplied labels (model names,
 *  filenames). authMiddleware is mounted at the server level so this whole router is
 *  protected; the client uses fetch-based SSE so the Authorization header travels
 *  with /jobs/stream too. */
export const jobRoutes = new Hono<AuthEnv>()
  .get('/', (c) => c.json(jobStore.list()))

  .get('/stream', async (c) =>
    streamSSE(c, async (stream) => {
      // Subscribe BEFORE writing the snapshot. Updates that fire between the
      // snapshot read and this subscribe call would otherwise be dropped, and the
      // client would be stuck on a stale view until the next mutation. Buffer those
      // updates and flush them after the snapshot lands so the order stays right.
      const buffered: Array<{ event: string; data: string }> = [];
      let flushed = false;
      const unsubscribe = jobStore.subscribe(async (update) => {
        const message = update.type === 'job' ? { event: 'job', data: JSON.stringify(update.job) } : { event: 'remove', data: JSON.stringify({ id: update.id }) };
        if (!flushed) {
          buffered.push(message);
          return;
        }
        try {
          await stream.writeSSE(message);
        } catch (err) {
          // Stream is broken (client disconnected, network error). Drop ourselves so
          // we don't spam the listener registry with dead handlers.
          console.warn('[jobs/stream] write failed, unsubscribing', err);
          unsubscribe();
        }
      });

      try {
        await stream.writeSSE({ event: 'snapshot', data: JSON.stringify(jobStore.list()) });
        for (const message of buffered) {
          await stream.writeSSE(message);
        }
        flushed = true;
      } catch (err) {
        console.warn('[jobs/stream] initial snapshot failed', err);
        unsubscribe();
        return;
      }

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          unsubscribe();
          resolve();
        });
      });
    }),
  )

  .delete('/:id', zValidator('param', idParamSchema), (c) => {
    const { id } = c.req.valid('param');
    const dismissed = jobStore.dismiss(id);
    if (!dismissed) {
      return c.json({ message: 'Job not found or still running' }, 409);
    }
    return c.body(null, 204);
  });
