import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireScope } from '../middleware';
import { generationService } from '../services';

const tuningSchema = z
  .object({
    pitchShift: z.number().optional(),
    speedMultiplier: z.number().optional(),
    variationSeed: z.number().optional(),
  })
  .passthrough();

const generateSchema = z.object({
  voice: z.string().min(1),
  input: z.string().min(1),
  speed: z.number().min(0.1).max(5).optional(),
  tuning: tuningSchema.optional(),
  editorContent: z.record(z.string(), z.any()).optional(),
});

export const generateRoutes = new Hono<AuthEnv>()
  .use(requireScope('generate'))
  .post('', zValidator('json', generateSchema), async (c) => {
    const result = await generationService.generateBuffered(c.req.valid('json'), c.get('userId'));
    return new Response(result.audio, {
      headers: {
        'Content-Type': result.contentType,
        'X-Generation-Id': result.generationId,
      },
    });
  })
  .post('/stream', zValidator('json', generateSchema), async (c) => {
    const result = await generationService.generateStreaming(c.req.valid('json'), c.get('userId'));
    if (result.type === 'streaming') {
      return new Response(result.stream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Sample-Rate': String(result.sampleRate),
          'X-Channels': '1',
          'X-Bits-Per-Sample': '16',
          'X-Generation-Id': result.generationId,
        },
      });
    }
    return new Response(result.audio, {
      headers: {
        'Content-Type': result.contentType,
        'X-Generation-Id': result.generationId,
      },
    });
  });
