import type { PocketBaseRecord } from './base.type';

export interface User extends PocketBaseRecord {
  email: string;
  name: string;
  avatar: string;
  verified: boolean;
  role: 'user' | 'admin';
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  avatar?: string;
  verified: boolean;
  created: string;
}
