import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { sessionRepository } from '../repositories';

const idParamSchema = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  name: z.string().max(120).optional(),
  generations: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  generations: z.array(z.string()).optional(),
});

export const sessionRoutes = new Hono<AuthEnv>()
  .get('', async (c) => {
    const userId = c.get('userId') as string;
    const sessions = await sessionRepository.getAllBy(`user = "${userId}"`, { sort: '-updated' });
    return c.json(sessions);
  })

  .get('/:id', zValidator('param', idParamSchema), async (c) => {
    const userId = c.get('userId') as string;
    const { id } = c.req.valid('param');
    const session = await sessionRepository.getOne(id);
    if (!session || session.user !== userId) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json(session);
  })

  .post('', zValidator('json', createSchema), async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    const created = await sessionRepository.create({
      name: body.name ?? '',
      user: userId,
      generations: body.generations ?? [],
    });
    return c.json(created, 201);
  })

  .patch('/:id', zValidator('param', idParamSchema), zValidator('json', updateSchema), async (c) => {
    const userId = c.get('userId') as string;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const existing = await sessionRepository.getOne(id);
    if (!existing || existing.user !== userId) {
      return c.json({ error: 'Session not found' }, 404);
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      patch.name = body.name ?? '';
    }
    if (body.generations !== undefined) {
      patch.generations = body.generations;
    }

    const updated = await sessionRepository.update(id, patch);
    return c.json(updated);
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    const userId = c.get('userId') as string;
    const { id } = c.req.valid('param');
    const existing = await sessionRepository.getOne(id);
    if (!existing || existing.user !== userId) {
      return c.json({ error: 'Session not found' }, 404);
    }
    await sessionRepository.delete(id);
    return c.body(null, 204);
  });
