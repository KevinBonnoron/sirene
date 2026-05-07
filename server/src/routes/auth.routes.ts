import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { authService, InvalidCredentialsError, mapServiceError, RegistrationFailedError } from '../services';

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
      return c.json(await authService.login(email, password));
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        return c.json({ code: err.code }, 401);
      }
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .post('/register', zValidator('json', registerSchema), async (c) => {
    try {
      return c.json(await authService.register(c.req.valid('json')), 201);
    } catch (err) {
      if (err instanceof RegistrationFailedError) {
        return c.json({ code: err.code }, 400);
      }
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .post('/refresh', async (c) => {
    try {
      return c.json(await authService.refreshFromBearer(c.req.header('Authorization')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .get('/me', async (c) => {
    try {
      return c.json(await authService.meFromBearer(c.req.header('Authorization')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });
