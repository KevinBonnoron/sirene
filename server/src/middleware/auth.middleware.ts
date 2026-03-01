import type { Context, Next } from 'hono';
import PocketBase from 'pocketbase';
import { config } from '../lib/config';

export type AuthEnv = { Variables: { userId: string } };

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
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  await next();
}
