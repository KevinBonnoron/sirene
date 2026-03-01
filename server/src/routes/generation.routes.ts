import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { generationRepository } from '../repositories';

const idParamSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  voice: z.string().optional(),
  model: z.string().optional(),
});

export const generationRoutes = new Hono<AuthEnv>()
  .get('', zValidator('query', listQuerySchema), async (c) => {
    const userId = c.get('userId') as string;
    const { voice, model } = c.req.valid('query');

    const filters: string[] = [`user = "${userId}"`];
    if (voice) {
      filters.push(`voice = "${voice}"`);
    }
    if (model) {
      filters.push(`model = "${model}"`);
    }

    const generations = await generationRepository.getAllBy(filters.join(' && '));
    return c.json(generations);
  })

  .get('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const generation = await generationRepository.getOne(id);
    if (!generation) {
      return c.json({ error: 'Generation not found' }, 404);
    }
    return c.json(generation);
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    await generationRepository.delete(id);
    return c.body(null, 204);
  });
