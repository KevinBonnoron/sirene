import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireAdmin } from '../middleware';
import { inferenceServerRepository } from '../repositories';
import { inferenceServerService, serverModelsService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

const writeBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2048),
  enabled: z.boolean(),
  priority: z.number().int(),
  auth_token: z.string().max(200).optional(),
});

const updateBodySchema = writeBodySchema.partial();

/** Browser-side CRUD for inference servers. PB rules are locked to superuser-only;
 *  every route here is gated by `requireAdmin` (authenticated user with `is_admin=true`)
 *  to enforce the same constraint at the application layer. The server's pb client is
 *  authenticated as superuser via initPocketBase(), so the repository writes succeed
 *  for the admin user without granting them PB superuser credentials. */
export const inferenceServerRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)

  .post('/', zValidator('json', writeBodySchema), async (c) => {
    const body = c.req.valid('json');
    try {
      const created = await inferenceServerRepository.create({
        ...body,
        url: body.url.replace(/\/$/, ''),
        last_health_status: 'unknown',
        last_health_at: '',
        last_health_error: '',
      });
      return c.json(created, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create server';
      return c.json({ message }, 400);
    }
  })

  .patch('/:id', zValidator('param', idParamSchema), zValidator('json', updateBodySchema), async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const payload = body.url ? { ...body, url: body.url.replace(/\/$/, '') } : body;
    try {
      const updated = await inferenceServerRepository.update(id, payload);
      // url / auth_token / enabled changes invalidate the cached inventory for this
      // server — without this, routing would keep using the old endpoint for up to
      // the cache TTL.
      serverModelsService.invalidate(id);
      return c.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update server';
      return c.json({ message }, 400);
    }
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    try {
      await inferenceServerRepository.delete(id);
      serverModelsService.invalidate(id);
      return c.body(null, 204);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete server';
      return c.json({ message }, 400);
    }
  })

  .post('/:id/test', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    try {
      const server = await inferenceServerService.checkOne(id);
      if (!server) {
        return c.json({ message: 'Server not found' }, 404);
      }
      serverModelsService.invalidate(id);
      return c.json(server);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Probe failed';
      return c.json({ message }, 502);
    }
  });
