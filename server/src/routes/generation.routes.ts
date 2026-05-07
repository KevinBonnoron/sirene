import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { generationService, mapServiceError } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  voice: z.string().optional(),
  model: z.string().optional(),
});

export const generationRoutes = new Hono<AuthEnv>()
  .get('', zValidator('query', listQuerySchema), async (c) => {
    return c.json(await generationService.listForUser(c.get('userId'), c.req.valid('query')));
  })

  .get('/:id', zValidator('param', idParamSchema), async (c) => {
    try {
      return c.json(await generationService.getById(c.req.valid('param').id));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .get('/:id/align', zValidator('param', idParamSchema), async (c) => {
    try {
      return c.json(await generationService.getAlignment(c.req.valid('param').id, c.get('userId')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    try {
      await generationService.delete(c.req.valid('param').id);
      return c.body(null, 204);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });
