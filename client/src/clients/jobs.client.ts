import type { Job } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const jobsClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    list: () => delegate.get<Job[]>('/jobs'),
    dismiss: (id: string) => delegate.delete<void>(`/jobs/${id}`),
  })),
);
