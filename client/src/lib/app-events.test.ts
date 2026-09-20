import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

interface OpenedStream {
  url: string;
  handler: (event: { event: string; data: string }) => void;
  onEnd?: (error?: unknown) => void;
  retries?: number;
  closed: boolean;
}

const opened: OpenedStream[] = [];

// config reads window.location at import time, which no test environment provides.
mock.module('./config', () => ({ config: { server: { url: '/api' }, pb: { url: 'http://test' } } }));

mock.module('./auth-stream', () => ({
  openAuthenticatedStream: (url: string, handler: OpenedStream['handler'], onEnd?: OpenedStream['onEnd'], retries?: number) => {
    const stream: OpenedStream = { url, handler, onEnd, retries, closed: false };
    opened.push(stream);
    return {
      close: () => {
        stream.closed = true;
      },
    };
  },
}));

const { subscribeToAppEvents } = await import('./app-events');

describe('app events', () => {
  // The module defers work on timers, so the test owns the clock. Cancellation has to be
  // honoured or a cleared timer would still fire and hide the very bug being tested.
  let timers = new Map<number, () => void>();
  let nextTimerId = 1;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  beforeEach(() => {
    opened.length = 0;
    timers = new Map();
    nextTimerId = 1;
    globalThis.setTimeout = ((fn: () => void) => {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((id: number) => {
      timers.delete(id);
    }) as typeof globalThis.clearTimeout;
  });

  let release: (() => void) | undefined;
  afterEach(() => {
    release?.();
    release = undefined;
    // The stream now outlives its last subscriber, so the module only returns to a clean
    // state once the idle timer has run.
    fireAll();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  function fireAll() {
    const due = [...timers.values()];
    timers.clear();
    for (const fire of due) {
      fire();
    }
  }

  test('one stream is shared by every subscriber', () => {
    const first = subscribeToAppEvents(() => {});
    const second = subscribeToAppEvents(() => {});
    expect(opened.length).toBe(1);
    first();
    expect(opened[0]?.closed).toBe(false);
    second();
    fireAll();
    expect(opened[0]?.closed).toBe(true);
  });

  test('a subscriber arriving during the idle delay keeps the stream', () => {
    const leaving = subscribeToAppEvents(() => {});
    leaving();
    // The navigation's next page subscribes before the idle timer fires.
    release = subscribeToAppEvents(() => {});
    fireAll();
    expect(opened.length).toBe(1);
    expect(opened[0]?.closed).toBe(false);
  });

  test('every subscriber receives an event', () => {
    const seen: string[] = [];
    const a = subscribeToAppEvents(({ event }) => seen.push(`a:${event}`));
    const b = subscribeToAppEvents(({ event }) => seen.push(`b:${event}`));
    opened[0]?.handler({ event: 'models', data: '1' });
    expect(seen).toEqual(['a:models', 'b:models']);
    a();
    b();
  });

  test('a subscriber that throws does not starve the others', () => {
    const seen: string[] = [];
    const a = subscribeToAppEvents(() => {
      throw new Error('boom');
    });
    const b = subscribeToAppEvents(({ event }) => seen.push(event));
    opened[0]?.handler({ event: 'models', data: '1' });
    expect(seen).toEqual(['models']);
    a();
    b();
  });

  test('a spent retry budget tells subscribers and reopens on the timer', () => {
    const seen: string[] = [];
    release = subscribeToAppEvents(({ event }) => seen.push(event));
    expect(opened.length).toBe(1);

    opened[0]?.onEnd?.();
    expect(seen).toEqual(['dropped']);
    // Scheduled, not immediate: a server that stays down is not hammered.
    expect(opened.length).toBe(1);
    expect(timers.size).toBe(1);

    fireAll();
    expect(opened.length).toBe(2);
  });

  test('a reopen scheduled before the last unsubscribe never happens', () => {
    const stop = subscribeToAppEvents(() => {});
    opened[0]?.onEnd?.();
    expect(timers.size).toBe(1);

    stop();
    fireAll();
    expect(opened.length).toBe(1);
  });

  test('the last unsubscribe stops the stream once the idle delay passes', () => {
    const stop = subscribeToAppEvents(() => {});
    stop();
    expect(opened[0]?.closed).toBe(false);
    fireAll();
    expect(opened[0]?.closed).toBe(true);
    // A fresh subscriber opens a new one rather than reusing the closed handle.
    const again = subscribeToAppEvents(() => {});
    expect(opened.length).toBe(2);
    again();
  });
});
