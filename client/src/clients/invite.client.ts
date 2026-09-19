import type { Invite, InviteCreated } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const inviteClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    list: () => delegate.get<Invite[]>('/invitations'),
    create: (email: string) => delegate.post<InviteCreated>('/invitations', { email }),
    revoke: (id: string) => delegate.delete<void>(`/invitations/${encodeURIComponent(id)}`),
    resolve: (token: string) => delegate.get<Invite>(`/invitations/${encodeURIComponent(token)}`),
  })),
);
