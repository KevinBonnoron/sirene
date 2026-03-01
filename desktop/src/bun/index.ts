import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electrobun/bun';

const PORT = 3000;
const PB_PORT = 8090;
const INFERENCE_PORT = 8000;

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
const SERVER_SCRIPT = join(RESOURCES_DIR, 'server.js');
const BUN_BINARY = process.argv0;

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

// --- Start Hono server as a separate Bun process ---
const serverProcess = spawn(BUN_BINARY, ['run', SERVER_SCRIPT], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SIRENE_PORT: String(PORT),
    SIRENE_CLIENT_DIR: CLIENT_DIR,
    POCKETBASE_URL: `http://127.0.0.1:${PB_PORT}`,
    PB_SUPERUSER_EMAIL,
    PB_SUPERUSER_PASSWORD,
    INFERENCE_URL: `http://127.0.0.1:${INFERENCE_PORT}`,
    MODELS_PATH: MODELS_DIR,
  },
});
serverProcess.on('error', (err) => console.error('Server failed to start:', err));
childProcesses.push(serverProcess);

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

// Clean up all child processes on exit
function cleanup() {
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
