import { Hono } from 'hono';

export const healthRoutes = new Hono().get('', (c) => c.json({ status: 'ok' }));

export const versionRoutes = new Hono().get('', (c) => c.json({ version: '0.1.0', name: 'sirene' }));
