import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireAdmin } from '../middleware';
import { inferenceServerService, mapServiceError } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

const writeBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2048),
  enabled: z.boolean(),
  priority: z.number().int(),
  authToken: z.string().max(200).optional(),
});

const updateBodySchema = writeBodySchema.partial();

/** Browser-side CRUD for inference servers. PB rules are locked to superuser-only;
 *  every route here is gated by `requireAdmin` (authenticated user with `role='admin'`)
 *  to enforce the same constraint at the application layer. The server's pb client is
 *  authenticated as superuser via initPocketBase(), so the repository writes succeed
 *  for the admin user without granting them PB superuser credentials. */
export const inferenceServerRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)

  .post('/', zValidator('json', writeBodySchema), async (c) => {
    try {
      return c.json(await inferenceServerService.create(c.req.valid('json')), 201);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status === 500 ? 400 : status);
    }
  })

  .patch('/:id', zValidator('param', idParamSchema), zValidator('json', updateBodySchema), async (c) => {
    try {
      return c.json(await inferenceServerService.update(c.req.valid('param').id, c.req.valid('json')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status === 500 ? 400 : status);
    }
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    try {
      await inferenceServerService.remove(c.req.valid('param').id);
      return c.body(null, 204);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status === 500 ? 400 : status);
    }
  })

  .post('/:id/test', zValidator('param', idParamSchema), async (c) => {
    try {
      return c.json(await inferenceServerService.checkOne(c.req.valid('param').id));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status === 500 ? 502 : status);
    }
  });
