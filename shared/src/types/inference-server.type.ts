import type { PocketBaseRecord } from './base.type';

export type InferenceServerHealthStatus = 'online' | 'offline' | 'unknown';

/** Snapshot of the last `/health` probe performed by the API's 15s health loop.
 *  Stored as a single PB json column so the three values stay in sync atomically. */
export interface InferenceServerHealth {
  /** ISO date of the last probe; empty string when never probed. */
  at: string;
  /** Empty string is treated as 'unknown'. */
  status: InferenceServerHealthStatus | '';
  error: string;
}

export interface InferenceServer extends PocketBaseRecord {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  lastHealth: InferenceServerHealth;
  /** Outbound auth token used by the API to authenticate against the remote inference server.
   *  PB-hidden — only admin reads return it; the client never sees this field. */
  authToken?: string;
}
