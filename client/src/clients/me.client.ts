import type { User } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const meClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    updateEmail: (email: string, currentPassword: string) => delegate.patch<{ token: string; user: User }>('/me/email', { email, currentPassword }),
  })),
);
