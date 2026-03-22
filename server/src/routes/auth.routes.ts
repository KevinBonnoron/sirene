import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { config } from '../lib/config';

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
      const userPb = new PocketBase(config.pb.url);
      await userPb.collection('users').create(body);
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
