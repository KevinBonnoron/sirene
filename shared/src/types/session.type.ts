import type { PocketBaseRecord } from './base.type';

export interface Session extends PocketBaseRecord {
  name: string;
  user: string;
  generations: string[];
  public?: boolean;
}
