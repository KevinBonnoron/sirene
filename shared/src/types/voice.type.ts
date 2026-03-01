import type { PocketBaseRecord } from './base.type';

export interface VoiceSample extends PocketBaseRecord {
  voice: string;
  audio: string;
  transcript: string;
  duration: number;
  order: number;
  enabled: boolean;
}

export interface Voice extends PocketBaseRecord {
  name: string;
  description: string;
  language: string;
  avatar: string;
  model: string;
  options: Record<string, unknown>;
  tags: string[];
  user: string;
  public: boolean;
}
