import type { PocketBaseRecord } from './base.type';

/** Capabilities an API key can be granted. JWT auth (the account owner via
 *  the web UI) is unconstrained: scopes only gate API-key bearer tokens.
 *
 *  `scopes === null` means full access (no restriction). An array means the
 *  key is restricted to exactly those capabilities; an empty array is
 *  rejected at create time so we never have to disambiguate "absent" from
 *  "intentionally empty". */
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
  created: string;
}

export interface ApiKeyCreated extends ApiKeySummary {
  /** Returned only on creation. Cannot be retrieved again. */
  secret: string;
}
