import type { PocketBaseRecord } from './base.type';

export type InferenceServerHealthStatus = 'online' | 'offline' | 'unknown';

export interface InferenceServerHealth {
  at: string;
  status: InferenceServerHealthStatus | '';
  error: string;
}

export interface InferenceServer extends PocketBaseRecord {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  lastHealth: InferenceServerHealth;
  /** PB-hidden field: only admin reads return it. */
  authToken?: string;
}
