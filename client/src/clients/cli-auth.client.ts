import type { ApiKeyScope } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export interface CliAuthLookup {
  code: string;
  expiresAt: string;
  status: 'pending' | 'authorized' | 'consumed';
  /** Scopes the CLI passed on `/start`. `null` = full access requested. */
  requestedScopes: ApiKeyScope[] | null;
}

export const cliAuthClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    lookup: (code: string) => delegate.get<CliAuthLookup>(`/auth/cli/lookup?code=${encodeURIComponent(code)}`),
    approve: (code: string, name: string, scopes: ApiKeyScope[] | null) => delegate.post<{ success: boolean }>('/auth/cli/approve', { code, name, scopes }),
  })),
);
