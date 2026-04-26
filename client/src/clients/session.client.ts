import type { Session } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const sessionClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    setPublic(id: string, isPublic: boolean): Promise<Session> {
      return delegate.patch<Session>(`/sessions/${encodeURIComponent(id)}/share`, { public: isPublic });
    },
  })),
);
