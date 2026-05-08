import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { mapServiceError, sessionService } from '../services';

const idParamSchema = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  name: z.string().max(120).optional(),
  generations: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  generations: z.array(z.string()).optional(),
});

const shareSchema = z.object({
  public: z.boolean(),
});

export const sessionRoutes = new Hono<AuthEnv>()
  .get('', async (c) => {
    try {
      return c.json(await sessionService.listForUser(c.get('userId')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .get('/:id', zValidator('param', idParamSchema), async (c) => {
    try {
      return c.json(await sessionService.getOwned(c.req.valid('param').id, c.get('userId')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .post('', zValidator('json', createSchema), async (c) => {
    try {
      return c.json(await sessionService.create(c.get('userId'), c.req.valid('json')), 201);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .patch('/:id', zValidator('param', idParamSchema), zValidator('json', updateSchema), async (c) => {
    try {
      return c.json(await sessionService.update(c.req.valid('param').id, c.get('userId'), c.req.valid('json')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    try {
      await sessionService.delete(c.req.valid('param').id, c.get('userId'));
      return c.body(null, 204);
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })

  .patch('/:id/share', zValidator('param', idParamSchema), zValidator('json', shareSchema), async (c) => {
    try {
      return c.json(await sessionService.setPublic(c.req.valid('param').id, c.get('userId'), c.req.valid('json').public));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });
