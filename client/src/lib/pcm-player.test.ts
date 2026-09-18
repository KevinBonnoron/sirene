import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPcmPlayer, openPlaybackContext } from './pcm-player';
import { stopPlayback } from './playback-owner';

interface FakeSource {
  buffer: { duration: number; channel: Float32Array } | null;
  startedAt: number;
  stopped: boolean;
  onended: (() => void) | null;
  connect(): void;
  start(at: number): void;
  stop(): void;
}

const sources: FakeSource[] = [];
let closed = false;
let now = 0;

class FakeAudioContext {
  public destination = {};
  public get currentTime() {
    return now;
  }
  public createBuffer(_channels: number, frames: number, sampleRate: number) {
    const channel = new Float32Array(frames);
    return {
      duration: frames / sampleRate,
      channel,
      copyToChannel(source: Float32Array) {
        channel.set(source);
      },
    };
  }
  public createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      startedAt: -1,
      stopped: false,
      onended: null,
      connect() {},
      start(at: number) {
        this.startedAt = at;
      },
      stop() {
        this.stopped = true;
      },
    };
    sources.push(source);
    return source;
  }
  public resume() {
    return Promise.resolve();
  }
  public close() {
    closed = true;
    return Promise.resolve();
  }
}

// int16 little-endian, the wire format the worker sends.
function pcm(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, i) => {
    view.setInt16(i * 2, value, true);
  });
  return bytes;
}

// The context is opened by the caller, from the user gesture, and handed to the player.
function makePlayer(sampleRate: number) {
  const context = openPlaybackContext();
  return context ? createPcmPlayer(context, sampleRate) : null;
}

beforeEach(() => {
  sources.length = 0;
  closed = false;
  now = 0;
  (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeAudioContext };
});

afterEach(() => {
  stopPlayback();
});

describe('createPcmPlayer', () => {
  test('decodes signed 16-bit little-endian into normalised floats', () => {
    const player = makePlayer(24000);
    player?.push(pcm(0, 32767, -32768, 16384));
    expect(sources).toHaveLength(1);
    const channel = sources[0].buffer?.channel as Float32Array;
    expect(Array.from(channel)).toEqual([0, 32767 / 32768, -1, 0.5]);
  });

  test('a sample split across two chunks is not dropped or misread', () => {
    const player = makePlayer(24000);
    const whole = pcm(1000, -1000);
    // An HTTP chunk boundary respects nothing, least of all sample alignment.
    player?.push(whole.slice(0, 3));
    player?.push(whole.slice(3));
    const decoded = sources.flatMap((s) => Array.from(s.buffer?.channel ?? []));
    expect(decoded).toEqual([1000 / 32768, -1000 / 32768]);
  });

  test('a lone odd byte schedules nothing until its partner arrives', () => {
    const player = makePlayer(24000);
    player?.push(new Uint8Array([0x01]));
    expect(sources).toHaveLength(0);
    player?.push(new Uint8Array([0x00]));
    expect(sources).toHaveLength(1);
  });

  test('chunks are scheduled back to back rather than all at once', () => {
    const player = makePlayer(1000);
    player?.push(pcm(...new Array(500).fill(0)));
    player?.push(pcm(...new Array(250).fill(0)));
    expect(sources).toHaveLength(2);
    // 500 frames at 1 kHz is half a second, so the second chunk follows the first.
    expect(sources[1].startedAt).toBeCloseTo(sources[0].startedAt + 0.5, 6);
  });

  test('a chunk arriving after the queue drained does not play in the past', () => {
    const player = makePlayer(1000);
    player?.push(pcm(...new Array(100).fill(0)));
    now = 60;
    player?.push(pcm(...new Array(100).fill(0)));
    expect(sources[1].startedAt).toBeGreaterThanOrEqual(now);
  });

  test('stop silences everything already scheduled', () => {
    const player = makePlayer(24000);
    player?.push(pcm(1, 2, 3, 4));
    player?.stop();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(closed).toBe(true);
  });

  test('the player tears itself down once the last chunk has played', () => {
    const player = makePlayer(24000);
    player?.push(pcm(1, 2));
    player?.endOfStream();
    expect(closed).toBe(false);
    sources[0].onended?.();
    expect(closed).toBe(true);
  });

  test('a stream that never produced audio still releases the context', () => {
    const player = makePlayer(24000);
    player?.endOfStream();
    expect(closed).toBe(true);
  });

  test('starting a second stream silences the first', () => {
    const first = makePlayer(24000);
    first?.push(pcm(1, 2));
    const firstSources = [...sources];
    makePlayer(24000);
    expect(firstSources.every((s) => s.stopped)).toBe(true);
  });

  test('an unusable sample rate yields no player rather than a broken one', () => {
    expect(makePlayer(Number.NaN)).toBeNull();
    expect(makePlayer(0)).toBeNull();
  });

  test('no audio support at all yields no context rather than throwing', () => {
    (globalThis as unknown as { window: unknown }).window = {};
    expect(openPlaybackContext()).toBeNull();
  });
});
