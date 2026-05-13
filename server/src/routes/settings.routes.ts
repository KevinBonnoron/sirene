import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthEnv, requireScope } from '../middleware';
import { settingsService } from '../services';

const SETTING_KEY = /^[a-z][a-z0-9_]*$/;

const updateSchema = z.object({
  key: z.string().regex(SETTING_KEY, 'invalid setting key'),
  value: z.string(),
});

const keyParamSchema = z.object({ key: z.string().regex(SETTING_KEY, 'invalid setting key') });

export const settingsRoutes = new Hono<AuthEnv>()
  .get('', requireScope('settings:read'), async (c) => c.json(await settingsService.listMaskedFor(c.get('userId'))))
  .put('', requireScope('settings:write'), zValidator('json', updateSchema), async (c) => {
    const { key, value } = c.req.valid('json');
    await settingsService.set(key, value, c.get('userId'));
    return c.json({ success: true });
  })
  .delete('/:key', requireScope('settings:write'), zValidator('param', keyParamSchema), async (c) => {
    await settingsService.delete(c.req.valid('param').key, c.get('userId'));
    return c.json({ success: true });
  });
