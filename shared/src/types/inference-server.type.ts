import type { PocketBaseRecord } from './base.type';

export type InferenceServerHealthStatus = 'online' | 'offline' | 'unknown';

export interface InferenceServerHealth {
  at: string;
  status: InferenceServerHealthStatus | '';
  error: string;
  /** cpu, cuda or mps as reported by the worker; empty when unknown */
  device?: string;
}

export interface InferenceServer extends PocketBaseRecord {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  /** Receive models already present on other servers when this one joins or comes back. */
  autoSync: boolean;
  lastHealth: InferenceServerHealth;
  /** PB-hidden field: only admin reads return it. */
  authToken?: string;
}
