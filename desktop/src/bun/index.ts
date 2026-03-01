import { BrowserWindow } from 'electrobun/bun';
import { app } from '@sirene/server';
import { join } from 'node:path';

const PORT = 3000;

// In the build output, this file is at Resources/app/bun/index.js
// The client dist is copied to Resources/client/
const CLIENT_DIR = join(import.meta.dir, '../../client');

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Delegate API requests to the Hono app
    if (url.pathname.startsWith('/api')) {
      return app.fetch(request);
    }

    // Serve client static files with SPA fallback to index.html
    const file = Bun.file(join(CLIENT_DIR, url.pathname));
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response(Bun.file(join(CLIENT_DIR, 'index.html')));
  },
  idleTimeout: 255,
});

const win = new BrowserWindow({
  title: 'Sirene',
  width: 1280,
  height: 800,
  url: `http://127.0.0.1:${PORT}`,
});

win.show();
