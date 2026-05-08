import type { Context, Next } from 'hono';
import PocketBase from 'pocketbase';
import { config } from '../lib/config';

export type AuthEnv = { Variables: { userId: string; isAdmin: boolean } };

export async function authMiddleware(c: Context, next: Next) {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authorization.slice(7);

  try {
    const userPb = new PocketBase(config.pb.url);
    userPb.authStore.save(token, null);
    const authData = await userPb.collection('users').authRefresh();
    c.set('userId', authData.record.id);
    c.set('isAdmin', authData.record.role === 'admin');
  } catch (err) {
    // PB raises ClientResponseError with a numeric `status`. 401/403 mean the
    // token is genuinely bad; anything else (PB unreachable, 5xx) is upstream
    // failure that we shouldn't paper over as "expired token", because that
    // would log a user out for a transient outage.
    const status = (err as { status?: unknown })?.status;
    if (status === 401 || status === 403) {
      return c.json({ message: 'Invalid or expired token' }, 401);
    }
    console.error('[auth] PocketBase auth refresh failed', err);
    return c.json({ message: 'Authentication service unavailable' }, 503);
  }

  await next();
}

/** Mount after `authMiddleware` on routes that should only be reachable by users
 *  with `role = 'admin'` (the deployment owner - the first registered user). */
export async function requireAdmin(c: Context<AuthEnv>, next: Next) {
  if (!c.get('isAdmin')) {
    return c.json({ message: 'Forbidden' }, 403);
  }

  await next();
}
