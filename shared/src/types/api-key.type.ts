import type { PocketBaseRecord } from './base.type';

// `scopes === null` means full access; an empty array is rejected at create time.
export const API_KEY_SCOPES = ['generate', 'transcribe', 'voices:read', 'voices:write', 'models:read', 'models:write', 'generations:read', 'generations:write', 'sessions:read', 'sessions:write', 'inference-servers:read', 'inference-servers:write', 'settings:read', 'settings:write'] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKey extends PocketBaseRecord {
  user: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: ApiKeyScope[] | null;
  lastUsedAt?: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[] | null;
  lastUsedAt?: string;
  revokedAt?: string;
  created: string;
}

export interface ApiKeyCreated extends ApiKeySummary {
  secret: string;
}
