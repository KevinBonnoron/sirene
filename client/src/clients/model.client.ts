import type { CatalogModel, Model, PresetVoice } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export const modelClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    catalog: () => delegate.get<CatalogModel[]>('/models/catalog'),
    installed: () => delegate.get<Model[]>('/models/installed'),
    voices: (modelId: string) => delegate.get<PresetVoice[]>(`/models/${modelId}/voices`),
    pull: (id: string) => delegate.post<{ jobId: string }>(`/models/${id}/pull`, {}),
    remove: (id: string) => delegate.delete<void>(`/models/${id}`),
    importPiper: (formData: FormData) => delegate.post<{ id: string; message: string }>('/models/piper/import', formData),
    exportPiper: async (id: string): Promise<Blob> => {
      const token = (await import('@/lib/auth-interceptor')).getStoredToken();
      const res = await fetch(`${config.server.url}/models/${id}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error('Export failed');
      }
      return res.blob();
    },
  })),
);
