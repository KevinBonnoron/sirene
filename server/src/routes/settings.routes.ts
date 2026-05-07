import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { settingsService } from '../services';

const updateSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const settingsRoutes = new Hono<AuthEnv>()
  .get('', async (c) => {
    return c.json(await settingsService.listMaskedFor(c.get('userId')));
  })
  .put('', zValidator('json', updateSchema), async (c) => {
    const { key, value } = c.req.valid('json');
    await settingsService.set(key, value, c.get('userId'));
    return c.json({ success: true });
  })
  .delete('/:key', async (c) => {
    await settingsService.delete(c.req.param('key'), c.get('userId'));
    return c.json({ success: true });
  });
