import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../middleware';
import { mapServiceError, settingsService } from '../services';

const SETTING_KEY = /^[a-z][a-z0-9_]*$/;

const updateSchema = z.object({
  key: z.string().regex(SETTING_KEY, 'invalid setting key'),
  value: z.string(),
});

const keyParamSchema = z.object({ key: z.string().regex(SETTING_KEY, 'invalid setting key') });

export const settingsRoutes = new Hono<AuthEnv>()
  .get('', async (c) => {
    try {
      return c.json(await settingsService.listMaskedFor(c.get('userId')));
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })
  .put('', zValidator('json', updateSchema), async (c) => {
    const { key, value } = c.req.valid('json');
    try {
      await settingsService.set(key, value, c.get('userId'));
      return c.json({ success: true });
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  })
  .delete('/:key', zValidator('param', keyParamSchema), async (c) => {
    try {
      await settingsService.delete(c.req.valid('param').key, c.get('userId'));
      return c.json({ success: true });
    } catch (err) {
      const { status, body } = mapServiceError(err);
      return c.json(body, status);
    }
  });
