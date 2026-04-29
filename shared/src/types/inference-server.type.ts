import type { PocketBaseRecord } from './base.type';

export type InferenceServerHealthStatus = 'online' | 'offline' | 'unknown';

export interface InferenceServer extends PocketBaseRecord {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  /** ISO date of the last health probe; empty string when never probed. */
  last_health_at: string;
  /** Empty string is treated as 'unknown'. */
  last_health_status: InferenceServerHealthStatus | '';
  last_health_error: string;
  /** Outbound auth token used by the API to authenticate against the remote inference server.
   *  PB-hidden — only admin reads return it; the client never sees this field. */
  auth_token?: string;
}
