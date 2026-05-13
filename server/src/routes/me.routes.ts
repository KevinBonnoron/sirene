import { Hono } from 'hono';
import type { AuthEnv } from '../middleware';
import { userService } from '../services';

/** `GET /api/me` returns the caller's identity. Works with both JWT and API
 *  key auth so the CLI can call it for "logged in as ..." status display.
 *  Restricted API keys get a redacted shape (no email/name/role) so a
 *  third-party integration the user gave limited access to can't read the
 *  account owner's PII; see `userService.getMe`. */
export const meRoutes = new Hono<AuthEnv>().get('', async (c) => c.json(await userService.getMe(c.get('userId'), c.get('scopes'))));
