import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireScope } from '../middleware';
import { generationService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  voice: z.string().optional(),
  model: z.string().optional(),
});

export const generationRoutes = new Hono<AuthEnv>()
  .get('', requireScope('generations:read'), zValidator('query', listQuerySchema), async (c) => c.json(await generationService.listForUser(c.get('userId'), c.req.valid('query'))))
  .get('/:id', requireScope('generations:read'), zValidator('param', idParamSchema), async (c) => c.json(await generationService.getById(c.req.valid('param').id, c.get('userId'))))
  .get('/:id/align', requireScope('generations:read'), zValidator('param', idParamSchema), async (c) => c.json(await generationService.getAlignment(c.req.valid('param').id, c.get('userId'))))
  .delete('/:id', requireScope('generations:write'), zValidator('param', idParamSchema), async (c) => {
    await generationService.delete(c.req.valid('param').id, c.get('userId'));
    return c.body(null, 204);
  });
