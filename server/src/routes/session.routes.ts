import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireScope } from '../middleware';
import { sessionService } from '../services';

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
  .get('', requireScope('sessions:read'), async (c) => c.json(await sessionService.listForUser(c.get('userId'))))
  .get('/:id', requireScope('sessions:read'), zValidator('param', idParamSchema), async (c) => c.json(await sessionService.getOwned(c.req.valid('param').id, c.get('userId'))))
  .post('', requireScope('sessions:write'), zValidator('json', createSchema), async (c) => c.json(await sessionService.create(c.get('userId'), c.req.valid('json')), 201))
  .patch('/:id', requireScope('sessions:write'), zValidator('param', idParamSchema), zValidator('json', updateSchema), async (c) => c.json(await sessionService.update(c.req.valid('param').id, c.get('userId'), c.req.valid('json'))))
  .delete('/:id', requireScope('sessions:write'), zValidator('param', idParamSchema), async (c) => {
    await sessionService.delete(c.req.valid('param').id, c.get('userId'));
    return c.body(null, 204);
  })
  .patch('/:id/share', requireScope('sessions:write'), zValidator('param', idParamSchema), zValidator('json', shareSchema), async (c) => c.json(await sessionService.setPublic(c.req.valid('param').id, c.get('userId'), c.req.valid('json').public)));
