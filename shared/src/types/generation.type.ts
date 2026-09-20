import type { PocketBaseRecord } from './base.type';

export type GenerationState = 'draft' | 'ready' | 'tuned';

export interface GenerationTuning {
  pitchShift: number;
  speedMultiplier: number;
  /** Absent means unseeded: the worker draws freely and needs no exclusivity. */
  variationSeed?: number;
  prosodyCurve?: Array<[number, number]>;
  wordRates?: Record<string, number>;
}

export interface Generation extends PocketBaseRecord {
  /** Inference server that produced the audio; empty for cloud providers and older records. */
  server?: string;
  voice: string;
  model: string;
  text: string;
  language: string;
  audio: string;
  duration: number;
  speed: number;
  user: string;
  state?: GenerationState;
  tuning?: GenerationTuning;
  editorContent?: object;
  /** Denormalised from the parent session; flips when the session is shared/unshared. */
  public?: boolean;
}
