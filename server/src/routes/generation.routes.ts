import { zValidator } from '@hono/zod-validator';
import type { GenerationAlignment, WordAlignment } from '@sirene/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { generationRepository } from '../repositories';

const idParamSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  voice: z.string().optional(),
  model: z.string().optional(),
});

/**
 * Splits a text into words with punctuation handling, preserving order.
 * Returns non-empty, whitespace-trimmed tokens.
 */
function splitWords(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Stub aligner: distributes words uniformly across the generation duration.
 * Replace with whisperx / MFA / model-native timestamps once available.
 */
function stubAlign(text: string, duration: number, generationId: string): GenerationAlignment {
  const words = splitWords(text);
  if (words.length === 0 || duration <= 0) {
    return { generationId, duration, words: [], stubbed: true };
  }
  const step = duration / words.length;
  const aligned: WordAlignment[] = words.map((w, i) => ({
    index: i,
    text: w,
    start: i * step,
    end: (i + 1) * step,
  }));
  return { generationId, duration, words: aligned, stubbed: true };
}

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

  .get('/:id/align', zValidator('param', idParamSchema), async (c) => {
    const userId = c.get('userId') as string;
    const { id } = c.req.valid('param');
    const generation = await generationRepository.getOne(id);
    if (!generation || generation.user !== userId) {
      return c.json({ error: 'Generation not found' }, 404);
    }
    const alignment = stubAlign(generation.text ?? '', generation.duration ?? 0, id);
    return c.json(alignment);
  })

  .delete('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    await generationRepository.delete(id);
    return c.body(null, 204);
  });
