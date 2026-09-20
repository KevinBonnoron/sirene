import type { Voice } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

// Creating and updating a voice go through PocketBase; what stays here is what a
// collection rule cannot express — packing and unpacking an archive.
export const voiceClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    exportZip: (id: string) => delegate.get<Blob>(`/voices/${id}/export`),
    importZip: (formData: FormData) => delegate.post<Voice>('/voices/import', formData),
  })),
);
