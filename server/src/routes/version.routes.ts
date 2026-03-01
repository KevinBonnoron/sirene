import { Hono } from 'hono';
import * as packageJson from '../../package.json';

export const versionRoutes = new Hono().get('', (c) => c.json({ version: packageJson.version, name: packageJson.name }));
