import type { GenerationTuning } from './generation.type';

export interface GenerateRequest {
  voice: string;
  input: string;
  speed?: number;
  tuning?: GenerationTuning;
  ssmlJson?: object;
}
