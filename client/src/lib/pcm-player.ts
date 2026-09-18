import { claimPlayback, releasePlayback } from './playback-owner';

// The first chunk is scheduled slightly ahead so a late second chunk does not leave a gap
// the moment playback starts.
const LEAD_SECONDS = 0.08;

export interface PcmPlayer {
  push(chunk: Uint8Array): void;
  /** No more chunks are coming; the player tears itself down once playback drains. */
  endOfStream(): void;
  stop(): void;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Opens the audio device. Call it from the user gesture that starts a generation, before
 * any await: Safari only unlocks a context created while the gesture is still running, and
 * the sample rate is not known until the response headers arrive.
 */
export function openPlaybackContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return null;
  }
  const context = new Ctor();
  void context.resume().catch(() => {});
  return context;
}

export function closePlaybackContext(context: AudioContext): void {
  void context.close().catch(() => {});
}

/**
 * Plays signed 16-bit little-endian mono PCM as it arrives, on a context opened earlier.
 * The context keeps its own rate and resamples each buffer, so a device that will not run
 * at the worker's rate still plays.
 */
export function createPcmPlayer(context: AudioContext, sampleRate: number): PcmPlayer | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }
  const sources = new Set<AudioBufferSourceNode>();
  let cursor = 0;
  let carry: Uint8Array | null = null;
  let stopped = false;
  let ended = false;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended; nothing to stop.
      }
    }
    sources.clear();
    releasePlayback(stop);
    void context.close().catch(() => {});
  };

  claimPlayback(stop);

  const toSamples = (chunk: Uint8Array): Float32Array => {
    let bytes = chunk;
    if (carry) {
      const joined = new Uint8Array(carry.length + chunk.length);
      joined.set(carry);
      joined.set(chunk, carry.length);
      bytes = joined;
      carry = null;
    }
    // A chunk boundary can fall inside a sample; the odd byte waits for the next one.
    const usable = bytes.length - (bytes.length % 2);
    if (usable < bytes.length) {
      carry = bytes.slice(usable);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
    const samples = new Float32Array(usable / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }
    return samples;
  };

  return {
    push(chunk) {
      if (stopped || chunk.length === 0) {
        return;
      }
      const samples = toSamples(chunk);
      if (samples.length === 0) {
        return;
      }
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(cursor, context.currentTime + LEAD_SECONDS);
      source.start(startAt);
      cursor = startAt + buffer.duration;
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        if (ended && sources.size === 0) {
          stop();
        }
      };
    },

    endOfStream() {
      ended = true;
      // Nothing was ever scheduled, or the tail already drained while the stream was closing.
      if (sources.size === 0) {
        stop();
      }
    },

    stop,
  };
}
