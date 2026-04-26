import { join } from 'node:path';
import { app } from '@sirene/server';

const PORT = Number(process.env.SIRENE_PORT);
const CLIENT_DIR = process.env.SIRENE_CLIENT_DIR!;

Bun.serve({
  port: PORT,
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

console.log(`Sirene server listening on http://127.0.0.1:${PORT}`);
