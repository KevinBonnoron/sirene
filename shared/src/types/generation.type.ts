import type { PocketBaseRecord } from './base.type';

export type GenerationState = 'draft' | 'ready' | 'tuned';

export interface GenerationTuning {
  pitchShift: number;
  speedMultiplier: number;
  variationSeed: number;
  prosodyCurve?: Array<[number, number]>;
  wordRates?: Record<string, number>;
}

export interface Generation extends PocketBaseRecord {
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
  ssml_json?: object;
}
