import { zValidator } from '@hono/zod-validator';
import { API_KEY_SCOPES, type ApiKeyScope } from '@sirene/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireJwtAuth } from '../middleware';
import { apiKeyService } from '../services';

const scopeSchema = z.enum(API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  /** `null` (or absent) grants full access; a non-empty array restricts the
   *  key to exactly those capabilities. An empty array is rejected by the
   *  service so callers can't accidentally mint a key that can do nothing. */
  scopes: z.array(scopeSchema).nullable().optional(),
});

const idParamSchema = z.object({ id: z.string().min(1) });

/** API-key management is itself a privileged operation: any caller that already
 *  has a key shouldn't be able to mint more. `requireJwtAuth` enforces that
 *  these routes are only reachable from a browser-authenticated session. */
export const apiKeyRoutes = new Hono<AuthEnv>()
  .use(requireJwtAuth)
  .get('', async (c) => c.json(await apiKeyService.listForUser(c.get('userId'))))
  .post('', zValidator('json', createSchema), async (c) => {
    const body = c.req.valid('json');
    return c.json(await apiKeyService.create(c.get('userId'), body.name, body.scopes ?? null), 201);
  })
  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    await apiKeyService.revoke(c.get('userId'), c.req.valid('param').id);
    return c.body(null, 204);
  });
