import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { generationRepository, sessionRepository } from '../repositories';

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
  })

  // Toggle public sharing. The flag must propagate to every generation in the session because
  // PB gates audio file URLs on the parent record's viewRule, and there's no way to walk a
  // back-relation in a rule expression. We denormalise here in one transactionish loop.
  .patch('/:id/share', zValidator('param', idParamSchema), zValidator('json', shareSchema), async (c) => {
    const userId = c.get('userId') as string;
    const { id } = c.req.valid('param');
    const { public: isPublic } = c.req.valid('json');

    const existing = await sessionRepository.getOne(id);
    if (!existing || existing.user !== userId) {
      return c.json({ error: 'Session not found' }, 404);
    }

    const generationIds = Array.isArray(existing.generations) ? existing.generations : [];
    const updated = await sessionRepository.update(id, { public: isPublic });

    // Best-effort denormalisation. If a referenced generation has been deleted (unusual but
    // possible if a cascade ran), skip it rather than failing the whole share toggle.
    await Promise.all(
      generationIds.map(async (genId) => {
        try {
          await generationRepository.update(genId, { public: isPublic });
        } catch {
          /* ignore — orphan reference */
        }
      }),
    );

    return c.json(updated);
  });
