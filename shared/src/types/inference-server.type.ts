import type { PocketBaseRecord } from './base.type';

export type InferenceServerHealthStatus = 'online' | 'offline' | 'unknown';

export interface InferenceServerHealth {
  at: string;
  status: InferenceServerHealthStatus | '';
  error: string;
  /** cpu, cuda or mps as reported by the worker; empty when unknown */
  device?: string;
  /** Total memory of the worker's first GPU in bytes; 0 without a GPU. */
  vram?: number;
}

export type SyncPolicy = 'all' | 'cpu' | 'gpu' | 'none';

export interface InferenceServer extends PocketBaseRecord {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  /** Which catalog models land here automatically: every fitting one, CPU-capable only, GPU-only only, or none. */
  syncPolicy: SyncPolicy;
  /** Non-secret handle of the registration token that created or last re-registered this server. */
  registration?: string;
  lastHealth: InferenceServerHealth;
  /** PB-hidden field: only admin reads return it. */
  authToken?: string;
}
