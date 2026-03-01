import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

interface PreviewRequest {
  modelId: string;
  text: string;
  instructText: string;
  gender: 'male' | 'female';
  language: string;
}

export const voiceDesignerClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    preview: async (request: PreviewRequest): Promise<Blob> => {
      const response = await delegate.post<Response>('/voice-designer/preview', request, { format: 'raw' });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      return response.blob();
    },
    save: (formData: FormData) => delegate.post<{ id: string }>('/voice-designer/save', formData),
  })),
);
