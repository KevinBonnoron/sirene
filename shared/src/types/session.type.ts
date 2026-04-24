import type { PocketBaseRecord } from './base.type';

export interface Session extends PocketBaseRecord {
  name: string;
  user: string;
  /** Ordered array of generation IDs — order is preserved by PocketBase. */
  generations: string[];
}
