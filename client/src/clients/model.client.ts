import type { CatalogModel, Model, PresetVoice } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const modelClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    catalog: () => delegate.get<CatalogModel[]>('/models/catalog'),
    installed: () => delegate.get<Model[]>('/models/installed'),
    voices: (modelId: string) => delegate.get<PresetVoice[]>(`/models/${encodeURIComponent(modelId)}/voices`),
    pull: (id: string, serverIds?: string[]) => delegate.post<{ jobIds: string[] }>(`/models/${encodeURIComponent(id)}/pull`, serverIds ? { serverIds } : {}),
    remove: (id: string, serverId?: string) => delegate.delete<void>(serverId ? `/models/${encodeURIComponent(id)}?serverId=${encodeURIComponent(serverId)}` : `/models/${encodeURIComponent(id)}`),
    importPiper: (formData: FormData) => delegate.post<{ id: string; jobIds: string[] }>('/models/piper/import', formData),
  })),
);
