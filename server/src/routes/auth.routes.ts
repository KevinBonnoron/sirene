import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { authService } from '../services';

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
    return c.json(await authService.login(email, password));
  })
  .post('/register', zValidator('json', registerSchema), async (c) => c.json(await authService.register(c.req.valid('json')), 201))
  .post('/refresh', async (c) => c.json(await authService.refreshFromBearer(c.req.header('Authorization'))))
  .get('/me', async (c) => c.json(await authService.meFromBearer(c.req.header('Authorization'))));
