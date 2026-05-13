import { zValidator } from '@hono/zod-validator';
import { API_KEY_SCOPES, type ApiKeyScope } from '@sirene/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, authMiddleware, requireJwtAuth } from '../middleware';
import { cliAuthService } from '../services';

const scopeSchema = z.enum(API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]]);

const startSchema = z.object({
  /** Where the UI is hosted, so the CLI can print/open a working URL.
   *  Sent by the CLI based on the configured server origin. */
  origin: z.string().url().optional(),
  /** Optional capability set the CLI wants the resulting key to be limited
   *  to. `null` / absent means full access. A non-empty array narrows the
   *  request; an empty array is rejected so an accidental `--scopes ""`
   *  doesn't silently widen back to full. */
  scopes: z.array(scopeSchema).nullable().optional(),
});

const pollSchema = z.object({
  deviceCode: z.string().min(1),
});

const codeQuerySchema = z.object({
  code: z.string().min(1),
});

const approveSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Final scope set the user chose at approval time. `null` = full access;
   *  a non-empty array must be a subset of what the CLI requested (enforced
   *  server-side). */
  scopes: z.array(scopeSchema).nullable().optional(),
});

/** Public CLI auth endpoints: invoked by the CLI process itself, no bearer
 *  required since the device-code is the credential. */
export const cliAuthPublicRoutes = new Hono()
  .post('/start', zValidator('json', startSchema), (c) => {
    const { origin, scopes } = c.req.valid('json');
    const base = origin ?? new URL(c.req.url).origin;
    const verificationUri = `${base.replace(/\/+$/, '')}/cli-auth`;
    return c.json(cliAuthService.start(verificationUri, scopes ?? null));
  })
  .post('/poll', zValidator('json', pollSchema), (c) => c.json(cliAuthService.poll(c.req.valid('json').deviceCode)));

/** Authenticated CLI auth endpoints: invoked by the browser UI after the user
 *  has logged in, to look up and approve a pending CLI session.
 *  Auth is enforced here (not just by the outer server mount) so the boundary
 *  is explicit and survives any future re-wiring of the router tree.
 *  `requireJwtAuth` blocks API-key callers: approving a CLI session mints
 *  another API key, so existing keys must not be able to extend themselves. */
export const cliAuthProtectedRoutes = new Hono<AuthEnv>()
  .use(authMiddleware)
  .use(requireJwtAuth)
  .get('/lookup', zValidator('query', codeQuerySchema), (c) => c.json(cliAuthService.lookup(c.req.valid('query').code)))
  .post('/approve', zValidator('json', approveSchema), async (c) => {
    const { code, name, scopes } = c.req.valid('json');
    await cliAuthService.approve(code, c.get('userId'), name, scopes ?? null);
    return c.json({ success: true });
  });
