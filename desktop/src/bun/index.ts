import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electrobun/bun';

// Pre-allocate a port for child processes (uvicorn) that need --port up front.
// The Hono server doesn't need this - Bun.serve({port:0}) returns the actual
// port via server.port after bind.
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('Failed to allocate port'));
      }
    });
  });
}

// PB stays on a fixed port because the SPA reaches it directly via the
// PocketBase JS SDK (realtime, file URLs) - making it dynamic would require
// injecting the URL into the client bundle. Inference is dynamic because only
// the in-process Hono server talks to it, via INFERENCE_URL env.
const PB_PORT = 8090;
const INFERENCE_PORT = await getFreePort();

// In the build output, this file is at Resources/app/bun/index.js
const RESOURCES_DIR = join(import.meta.dir, '../Resources');
const CLIENT_DIR = join(RESOURCES_DIR, 'client');

// App data stored in user's home directory
const APP_DATA_DIR = join(homedir(), '.sirene');
const PB_DATA_DIR = join(APP_DATA_DIR, 'pb_data');
const MODELS_DIR = join(APP_DATA_DIR, 'models');
const PACKAGES_DIR = join(APP_DATA_DIR, 'packages');
const PB_MIGRATIONS_DIR = join(RESOURCES_DIR, 'pb_migrations');
const PB_BINARY = join(RESOURCES_DIR, 'pocketbase');
const INFERENCE_DIR = join(RESOURCES_DIR, 'inference');
const PYTHON_DIR = join(RESOURCES_DIR, 'python');
const PYTHON_BIN = join(PYTHON_DIR, 'bin/python3');

const PB_SUPERUSER_EMAIL = 'admin@sirene.local';
const PB_SUPERUSER_PASSWORD = 'changeme123';
const DEFAULT_USER_EMAIL = 'user@sirene.local';
const DEFAULT_USER_PASSWORD = 'sirene1234';

mkdirSync(PB_DATA_DIR, { recursive: true });
mkdirSync(MODELS_DIR, { recursive: true });
mkdirSync(PACKAGES_DIR, { recursive: true });

if (existsSync(PB_BINARY)) {
  try {
    chmodSync(PB_BINARY, 0o755);
  } catch {
    // Binary may already be executable (e.g. read-only store on NixOS)
  }
}

async function waitForService(url: string, name: string, maxRetries = 50): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // Service not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`${name} failed to start`);
}

async function setupDefaultUser(): Promise<void> {
  const PocketBase = (await import('pocketbase')).default;
  const pb = new PocketBase(`http://127.0.0.1:${PB_PORT}`);

  try {
    await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
  } catch {
    console.warn('Admin auth failed, superuser may not exist yet');
    return;
  }

  try {
    await pb.collection('users').create({
      email: DEFAULT_USER_EMAIL,
      password: DEFAULT_USER_PASSWORD,
      passwordConfirm: DEFAULT_USER_PASSWORD,
      name: 'User',
      verified: true,
    });
    console.log('Default user created');
  } catch {
    // User already exists
  }
}

// Track child processes for cleanup
const childProcesses: ReturnType<typeof spawn>[] = [];

// --- Start PocketBase ---
Bun.spawnSync([PB_BINARY, 'superuser', 'upsert', PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD, `--dir=${PB_DATA_DIR}`, `--migrationsDir=${PB_MIGRATIONS_DIR}`]);

const pbProcess = spawn(PB_BINARY, ['serve', `--http=127.0.0.1:${PB_PORT}`, `--dir=${PB_DATA_DIR}`, `--migrationsDir=${PB_MIGRATIONS_DIR}`], {
  stdio: 'inherit',
});
pbProcess.on('error', (err) => console.error('PocketBase failed to start:', err));
childProcesses.push(pbProcess);

// --- Start Inference server ---
let inferenceAvailable = false;

if (existsSync(PYTHON_BIN)) {
  const inferenceProcess = spawn(PYTHON_BIN, ['-m', 'uvicorn', 'src.main:app', '--host', '127.0.0.1', '--port', String(INFERENCE_PORT)], {
    stdio: 'inherit',
    cwd: INFERENCE_DIR,
    env: {
      ...process.env,
      MODELS_PATH: MODELS_DIR,
      PACKAGES_DIR: PACKAGES_DIR,
      DEVICE: 'cpu',
      // Bundled inference is loopback-only and trusted by the local server;
      // matches install.sh full-mode (which also runs unauthenticated on the
      // internal docker network).
      INFERENCE_ALLOW_NO_AUTH: 'true',
    },
  });
  inferenceProcess.on('error', (err) => console.error('Inference server failed to start:', err));
  childProcesses.push(inferenceProcess);
  inferenceAvailable = true;
} else {
  console.warn('Inference environment not found, TTS generation will not be available');
  console.warn('Run desktop/scripts/setup-inference.sh to set up the inference environment');
}

// --- Wait for services ---
await waitForService(`http://127.0.0.1:${PB_PORT}/api/health`, 'PocketBase');
await setupDefaultUser();

if (inferenceAvailable) {
  await waitForService(`http://127.0.0.1:${INFERENCE_PORT}/health`, 'Inference', 150);
}

// --- Start Hono server in-process ---
// Env must be set before importing @sirene/server: config.ts reads
// POCKETBASE_URL / INFERENCE_URL at module-load time.
process.env.POCKETBASE_URL = `http://127.0.0.1:${PB_PORT}`;
process.env.PB_SUPERUSER_EMAIL = PB_SUPERUSER_EMAIL;
process.env.PB_SUPERUSER_PASSWORD = PB_SUPERUSER_PASSWORD;
process.env.INFERENCE_URL = `http://127.0.0.1:${INFERENCE_PORT}`;
process.env.MODELS_PATH = MODELS_DIR;

const { app } = await import('@sirene/server');

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      return app.fetch(request);
    }
    const file = Bun.file(join(CLIENT_DIR, url.pathname));
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response(Bun.file(join(CLIENT_DIR, 'index.html')));
  },
  idleTimeout: 255,
});

const PORT = server.port;
console.log(`Sirene server listening on http://127.0.0.1:${PORT}`);

await waitForService(`http://127.0.0.1:${PORT}/api/health`, 'Server');

// --- Open window ---
const win = new BrowserWindow({
  title: 'Sirene',
  frame: {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  },
  url: `http://127.0.0.1:${PORT}`,
});

win.show();

function cleanup() {
  server.stop(true);
  for (const proc of childProcesses) {
    proc.kill();
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit();
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit();
});
