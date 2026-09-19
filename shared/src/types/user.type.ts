import type { PocketBaseRecord } from './base.type';

export interface User extends PocketBaseRecord {
  email: string;
  name: string;
  avatar: string;
  verified: boolean;
  role: 'user' | 'admin';
}

export interface Invite {
  id: string;
  email: string;
  expiresAt: string;
  created: string;
}

export interface InviteCreated extends Invite {
  token: string;
}
