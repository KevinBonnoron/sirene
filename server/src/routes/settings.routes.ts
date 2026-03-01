import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteSetting, getAllSettings, setSetting } from '../lib/settings';
import type { AuthEnv } from '../middleware';

const updateSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const settingsRoutes = new Hono<AuthEnv>()
  .get('', async (c) => {
    const userId = c.get('userId') as string;
    const settings = await getAllSettings(userId);
    return c.json(settings);
  })
  .put('', zValidator('json', updateSchema), async (c) => {
    const userId = c.get('userId') as string;
    const { key, value } = c.req.valid('json');
    await setSetting(key, value, userId);
    return c.json({ success: true });
  })
  .delete('/:key', async (c) => {
    const userId = c.get('userId') as string;
    const key = c.req.param('key');
    await deleteSetting(key, userId);
    return c.json({ success: true });
  });
