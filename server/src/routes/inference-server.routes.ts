import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, authMiddleware } from '../middleware';
import { inferenceServerService, serverModelsService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Force an immediate health probe. Browser CORS prevents reliable direct probing,
 *  so this thin proxy is the only inference-server route still living on the API side. */
export const inferenceServerRoutes = new Hono<AuthEnv>().use(authMiddleware).post('/:id/test', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const server = await inferenceServerService.checkOne(id);
  if (!server) {
    return c.json({ message: 'Server not found' }, 404);
  }
  // A manual test is also a good moment to refresh which models live on this server.
  serverModelsService.invalidate(id);
  return c.json(server);
});
