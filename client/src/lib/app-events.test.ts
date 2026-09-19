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
  // The reopen is deferred, so the test owns the clock: a captured callback is the only
  // way to tell a scheduled reopen from no reopen at all.
  let scheduled: (() => void)[] = [];
  const realSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    opened.length = 0;
    scheduled = [];
    globalThis.setTimeout = ((fn: () => void) => {
      scheduled.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
  });

  let release: (() => void) | undefined;
  afterEach(() => {
    release?.();
    release = undefined;
    globalThis.setTimeout = realSetTimeout;
  });

  test('one stream is shared by every subscriber', () => {
    const first = subscribeToAppEvents(() => {});
    const second = subscribeToAppEvents(() => {});
    expect(opened.length).toBe(1);
    first();
    expect(opened[0]?.closed).toBe(false);
    second();
    expect(opened[0]?.closed).toBe(true);
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
    expect(scheduled.length).toBe(1);

    scheduled[0]?.();
    expect(opened.length).toBe(2);
  });

  test('a reopen scheduled before the last unsubscribe never happens', () => {
    const stop = subscribeToAppEvents(() => {});
    opened[0]?.onEnd?.();
    expect(scheduled.length).toBe(1);

    stop();
    scheduled[0]?.();
    expect(opened.length).toBe(1);
  });

  test('the last unsubscribe stops the stream', () => {
    const stop = subscribeToAppEvents(() => {});
    stop();
    expect(opened[0]?.closed).toBe(true);
    // A fresh subscriber opens a new one rather than reusing the closed handle.
    const again = subscribeToAppEvents(() => {});
    expect(opened.length).toBe(2);
    again();
  });
});
