import { buildWav, type GenerateRequest, type GenerationAlignment, readPcmStream } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export interface GenerateResult {
  audio: Blob;
  generationId: string | null;
}

export const generationClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const response = await delegate.post<Response>('/generate/stream', request, { format: 'raw' });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Generation failed' }));
        throw new Error(error.message || `Generation failed (${response.status})`);
      }

      const generationId = response.headers.get('X-Generation-Id');
      const sampleRateHeader = response.headers.get('X-Sample-Rate');

      // Non-PCM response (ElevenLabs / OpenAI): return blob directly
      if (!sampleRateHeader) {
        const audio = await response.blob();
        return { audio, generationId };
      }

      // PCM stream: accumulate chunks and build WAV
      const sampleRate = parseInt(sampleRateHeader, 10);
      const body = response.body;
      if (!body) {
        throw new Error('No response body');
      }
      const { chunks, totalBytes } = await readPcmStream(body);
      const audio = new Blob([buildWav(chunks, totalBytes, sampleRate)], { type: 'audio/wav' });
      return { audio, generationId };
    },

    align(id: string): Promise<GenerationAlignment> {
      return delegate.get<GenerationAlignment>(`/generations/${id}/align`);
    },
  })),
);
