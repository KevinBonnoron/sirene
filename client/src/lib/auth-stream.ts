import { getStoredToken } from './auth-interceptor';

const STABLE_MS = 30_000;
const DEFAULT_RETRIES = 5;

type SSEHandler = (event: { event: string; data: string }) => void;

interface StreamHandle {
  close: () => void;
}

// EventSource can't send an Authorization header, and a query-param token would leak into access logs.
export function openAuthenticatedStream(url: string, handler: SSEHandler, onEnd?: (error?: unknown) => void, retries = DEFAULT_RETRIES): StreamHandle {
  let controller = new AbortController();
  let closed = false;
  let attempt = 0;
  let connectedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearTimeout(timer);
    controller.abort();
  };

  // A dropped stream is reopened with backoff; onEnd only fires once the retry budget is spent.
  const start = () => {
    controller = new AbortController();
    void run()
      .then(() => settle())
      .catch((err) => {
        if (!closed && err.name !== 'AbortError') {
          console.warn('[auth-stream] disconnected', err);
          settle(err);
        }
      });
  };
  const settle = (err?: unknown) => {
    if (closed) {
      return;
    }
    // Only a connection that held for a while earns a fresh budget, so a stream that dies right after 200 still gives up.
    if (connectedAt && Date.now() - connectedAt > STABLE_MS) {
      attempt = 0;
    }
    connectedAt = 0;
    if (attempt < retries) {
      timer = setTimeout(start, Math.min(1000 * 2 ** attempt, 30_000));
      attempt += 1;
      return;
    }
    onEnd?.(err);
  };
  start();

  return { close };

  async function run() {
    const token = getStoredToken();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`stream HTTP ${response.status}`);
    }
    connectedAt = Date.now();

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    const EVENT_BOUNDARY = /\r\n\r\n|\r\r|\n\n/;
    while (!closed) {
      const { value, done } = await reader.read();
      if (done) {
        const trailing = buffer.trim();
        if (trailing) {
          const event = parseEvent(trailing);
          if (event) {
            handler(event);
          }
        }
        return;
      }
      buffer += value;
      let match = EVENT_BOUNDARY.exec(buffer);
      while (match) {
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parseEvent(raw);
        if (event) {
          handler(event);
        }
        match = EVENT_BOUNDARY.exec(buffer);
      }
    }
  }
}

function parseEvent(block: string): { event: string; data: string } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith(':') || line.length === 0) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join('\n') };
}
