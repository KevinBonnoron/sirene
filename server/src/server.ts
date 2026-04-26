import { apiReference } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { spec } from './lib/openapi';
import { initPocketBase } from './lib/pocketbase';
import { authMiddleware } from './middleware';
import { authRoutes, generateRoutes, generationRoutes, healthRoutes, jobRoutes, modelRoutes, sessionRoutes, settingsRoutes, transcribeRoutes, versionRoutes, voiceDesignerRoutes, voiceRoutes } from './routes';
import { modelService } from './services';

initPocketBase();
modelService.startModelWatcher();

export const app = new Hono()
  .basePath('/api')
  .use(cors({ origin: '*', exposeHeaders: ['X-Sample-Rate', 'X-Channels', 'X-Bits-Per-Sample', 'X-Generation-Id'] }))
  .use(logger())
  .get('/openapi.json', (c) => c.json(spec))
  .get('/docs', apiReference({ spec: { url: '/api/openapi.json' } }))
  // Public routes (no auth required)
  .route('/health', healthRoutes)
  .route('/version', versionRoutes)
  .route('/auth', authRoutes)
  .route('/jobs', jobRoutes)
  .route('/models', modelRoutes)
  // Protected routes (auth required)
  .use(authMiddleware)
  .route('/generate', generateRoutes)
  .route('/voices', voiceRoutes)
  .route('/generations', generationRoutes)
  .route('/sessions', sessionRoutes)
  .route('/transcribe', transcribeRoutes)
  .route('/settings', settingsRoutes)
  .route('/voice-designer', voiceDesignerRoutes);
