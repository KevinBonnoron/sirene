import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { config } from '../lib/config';
import { pb } from '../lib/pocketbase';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  passwordConfirm: z.string().min(8),
  name: z.string().min(1).optional(),
});

export const authRoutes = new Hono()
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json');

    try {
      const userPb = new PocketBase(config.pb.url);
      const authData = await userPb.collection('users').authWithPassword(email, password);
      return c.json({
        token: authData.token,
        user: {
          id: authData.record.id,
          email: authData.record.email,
          name: authData.record.name,
          avatar: authData.record.avatar,
          verified: authData.record.verified,
        },
      });
    } catch {
      return c.json({ code: 'invalidCredentials' }, 401);
    }
  })

  .post('/register', zValidator('json', registerSchema), async (c) => {
    const body = c.req.valid('json');

    try {
      // Always create as a regular user. Promotion to admin happens in a second step
      // gated by a partial unique index (`idx_users_single_admin`) that allows only
      // one row to hold is_admin = true. Two concurrent registrations on a fresh
      // install will both try to promote themselves; the DB guarantees only one wins.
      const userPb = new PocketBase(config.pb.url);
      const created = await userPb.collection('users').create({ ...body, is_admin: false });
      try {
        await pb.collection('users').update(created.id, { is_admin: true });
      } catch (err) {
        // Only the partial-unique-index conflict means "another admin already exists" —
        // anything else (PB down, network error) is a real failure and would otherwise
        // silently leave a deployment with zero admins. Log the unexpected paths so
        // the operator can react instead of seeing a clean 201.
        if (!isUniqueIndexConflict(err)) {
          console.error('[auth/register] failed to promote first user to admin', err);
        }
      }
      // Auto-login after registration
      const authData = await userPb.collection('users').authWithPassword(body.email, body.password);
      return c.json(
        {
          token: authData.token,
          user: {
            id: authData.record.id,
            email: authData.record.email,
            name: authData.record.name,
            avatar: authData.record.avatar,
            verified: authData.record.verified,
          },
        },
        201,
      );
    } catch {
      return c.json({ code: 'registrationFailed' }, 400);
    }
  })

  .post('/refresh', async (c) => {
    const authorization = c.req.header('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const userPb = new PocketBase(config.pb.url);
      userPb.authStore.save(authorization.slice(7), null);
      const authData = await userPb.collection('users').authRefresh();
      return c.json({
        token: authData.token,
        user: {
          id: authData.record.id,
          email: authData.record.email,
          name: authData.record.name,
          avatar: authData.record.avatar,
          verified: authData.record.verified,
        },
      });
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  })

  .get('/me', async (c) => {
    const authorization = c.req.header('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const userPb = new PocketBase(config.pb.url);
      userPb.authStore.save(authorization.slice(7), null);
      const authData = await userPb.collection('users').authRefresh();
      return c.json({
        id: authData.record.id,
        email: authData.record.email,
        name: authData.record.name,
        avatar: authData.record.avatar,
        verified: authData.record.verified,
      });
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  });

function isUniqueIndexConflict(err: unknown): boolean {
  // PocketBase surfaces uniqueness violations as ClientResponseError with the SQL
  // index name in the message. Match defensively rather than relying on err.status.
  if (!err || typeof err !== 'object') {
    return false;
  }
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
  if (message.includes('unique') || message.includes('idx_users_single_admin')) {
    return true;
  }
  // PB also sets per-field validation errors on response.data.{field}.code
  const data = (err as { response?: { data?: Record<string, { code?: string }> } }).response?.data;
  if (data && typeof data === 'object') {
    return Object.values(data).some((v) => v?.code === 'validation_not_unique');
  }
  return false;
}
