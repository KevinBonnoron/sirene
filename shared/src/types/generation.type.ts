import type { PocketBaseRecord } from './base.type';

export interface Generation extends PocketBaseRecord {
  voice: string;
  model: string;
  text: string;
  language: string;
  audio: string;
  duration: number;
  speed: number;
  user: string;
}
