import { getStoredToken } from './auth-interceptor';

type SSEHandler = (event: { event: string; data: string }) => void;

interface StreamHandle {
  close: () => void;
}

// EventSource can't send an Authorization header, and a query-param token would leak into access logs.
export function openAuthenticatedStream(url: string, handler: SSEHandler): StreamHandle {
  const controller = new AbortController();
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
  };

  void run().catch((err) => {
    if (!closed && err.name !== 'AbortError') {
      console.warn('[auth-stream] disconnected', err);
    }
  });

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
