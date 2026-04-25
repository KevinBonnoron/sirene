import type { PocketBaseRecord } from './base.type';

export interface Session extends PocketBaseRecord {
  name: string;
  user: string;
  /** Ordered array of generation IDs — order is preserved by PocketBase. */
  generations: string[];
  /** When true, the session is reachable read-only at /share/<id> without auth. */
  public?: boolean;
}
