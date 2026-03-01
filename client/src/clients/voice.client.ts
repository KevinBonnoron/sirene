import type { Voice } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const voiceClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    create: (formData: FormData) => delegate.post<Voice>('/voices', formData),
    update: (id: string, formData: FormData) => delegate.put<Voice>(`/voices/${id}`, formData),
    exportZip: (id: string) => delegate.get<Blob>(`/voices/${id}/export`),
    importZip: (formData: FormData) => delegate.post<Voice>('/voices/import', formData),
    createSample: (voiceId: string, formData: FormData) => delegate.post<unknown>(`/voices/${voiceId}/samples`, formData),
  })),
);
