import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { inferenceServerService, serverModelsService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Force an immediate health probe. The browser can't reliably probe arbitrary inference URLs
 *  (CORS, no auth header), so this thin proxy is the only inference-server route on the API
 *  side — CRUD lives directly on PocketBase via tanstack-db. */
export const inferenceServerRoutes = new Hono<AuthEnv>().post('/:id/test', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const server = await inferenceServerService.checkOne(id);
  if (!server) {
    return c.json({ message: 'Server not found' }, 404);
  }
  serverModelsService.invalidate(id);
  return c.json(server);
});
