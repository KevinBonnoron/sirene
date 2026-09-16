import type { InferenceServer, SyncPolicy } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

interface InferenceServerWritePayload {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  authToken?: string;
  syncPolicy?: SyncPolicy;
}

export const inferenceServerClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    create: (payload: InferenceServerWritePayload) => delegate.post<InferenceServer>('/inference-servers', payload),
    update: (id: string, payload: Partial<InferenceServerWritePayload>) => delegate.patch<InferenceServer>(`/inference-servers/${encodeURIComponent(id)}`, payload),
    remove: (id: string) => delegate.delete<void>(`/inference-servers/${encodeURIComponent(id)}`),
    createRegistrationToken: () => delegate.post<{ token: string; registration: string; expiresAt: string }>('/inference-servers/registration-tokens', {}),
  })),
);
