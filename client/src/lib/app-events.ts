import { openAuthenticatedStream } from './auth-stream';
import { config } from './config';

// Slow enough that a server that stays down is not hammered, quick enough that one coming
// back is picked up without a reload.
const REOPEN_DELAY_MS = 30_000;

/** `dropped` is synthesised when the retry budget runs out, so listeners can refetch once the stream returns. */
export type AppEvent = { event: string; data: string };
type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();
let stream: { close: () => void } | null = null;
let reopenTimer: ReturnType<typeof setTimeout> | undefined;

function emit(event: AppEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[app-events] a listener threw', error);
    }
  }
}

function open() {
  stream = openAuthenticatedStream(`${config.server.url}/events`, emit, () => {
    stream = null;
    emit({ event: 'dropped', data: '' });
    if (listeners.size > 0) {
      reopenTimer = setTimeout(() => {
        if (listeners.size > 0 && !stream) {
          open();
        }
      }, REOPEN_DELAY_MS);
    }
  });
}

export function subscribeToAppEvents(listener: Listener): () => void {
  listeners.add(listener);
  if (!stream) {
    clearTimeout(reopenTimer);
    open();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(reopenTimer);
      stream?.close();
      stream = null;
    }
  };
}
