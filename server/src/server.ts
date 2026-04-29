import { apiReference } from '@scalar/hono-api-reference';
import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { spec } from './lib/openapi';
import { initPocketBase } from './lib/pocketbase';
import { authMiddleware } from './middleware';
import { authRoutes, generateRoutes, generationRoutes, healthRoutes, inferenceServerRoutes, jobRoutes, modelRoutes, sessionRoutes, settingsRoutes, transcribeRoutes, versionRoutes, voiceDesignerRoutes, voiceRoutes } from './routes';
import { inferenceServerService, modelService } from './services';

const bootstrapPromise = (async () => {
  await initPocketBase();
  await inferenceServerService.bootstrapFromEnv();
  inferenceServerService.startHealthLoop();
})();

bootstrapPromise.catch((err) => {
  console.error('[server] bootstrap failed', err);
  process.exit(1);
});

modelService.startModelWatcher();

/** Block every request until bootstrap completes so handlers don't run against an
 *  uninitialised PocketBase or an empty inference-server registry. /health is exempt
 *  so liveness probes can come up before the rest of the stack. */
async function awaitBootstrap(c: Context, next: Next) {
  if (c.req.path !== '/api/health' && c.req.path !== '/api/health/') {
    await bootstrapPromise;
  }
  await next();
}

export const app = new Hono()
  .basePath('/api')
  .use(awaitBootstrap)
  .use(cors({ origin: '*', exposeHeaders: ['X-Sample-Rate', 'X-Channels', 'X-Bits-Per-Sample', 'X-Generation-Id'] }))
  .use(logger())
  .get('/openapi.json', (c) => c.json(spec))
  .get('/docs', apiReference({ spec: { url: '/api/openapi.json' } }))
  // Public routes (no auth required)
  .route('/health', healthRoutes)
  .route('/version', versionRoutes)
  .route('/auth', authRoutes)
  .route('/models', modelRoutes)
  // Protected routes (auth required)
  .use(authMiddleware)
  .route('/jobs', jobRoutes)
  .route('/inference-servers', inferenceServerRoutes)
  .route('/generate', generateRoutes)
  .route('/voices', voiceRoutes)
  .route('/generations', generationRoutes)
  .route('/sessions', sessionRoutes)
  .route('/transcribe', transcribeRoutes)
  .route('/settings', settingsRoutes)
  .route('/voice-designer', voiceDesignerRoutes);
