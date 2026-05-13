import type { ApiKeyCreated, ApiKeyScope, ApiKeySummary } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const apiKeyClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    list: () => delegate.get<ApiKeySummary[]>('/api-keys'),
    /** `scopes === null` mints a full-access key. Pass a non-empty array to
     *  restrict; the server rejects an empty array. */
    create: (name: string, scopes: ApiKeyScope[] | null) => delegate.post<ApiKeyCreated>('/api-keys', { name, scopes }),
    revoke: (id: string) => delegate.delete<void>(`/api-keys/${id}`),
  })),
);
