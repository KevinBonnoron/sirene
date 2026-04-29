import type { Context, Next } from 'hono';
import PocketBase from 'pocketbase';
import { config } from '../lib/config';

export type AuthEnv = { Variables: { userId: string; isAdmin: boolean } };

export async function authMiddleware(c: Context, next: Next) {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authorization.slice(7);

  try {
    const userPb = new PocketBase(config.pb.url);
    userPb.authStore.save(token, null);
    const authData = await userPb.collection('users').authRefresh();
    c.set('userId', authData.record.id);
    c.set('isAdmin', authData.record.is_admin === true);
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  await next();
}

/** Mount after `authMiddleware` on routes that should only be reachable by users
 *  flagged `is_admin = true` (the deployment owner — the first registered user). */
export async function requireAdmin(c: Context<AuthEnv>, next: Next) {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Forbidden — admin only' }, 403);
  }
  await next();
}
