import type { PocketBaseRecord } from './base.type';

export interface User extends PocketBaseRecord {
  email: string;
  name: string;
  avatar: string;
  verified: boolean;
}
