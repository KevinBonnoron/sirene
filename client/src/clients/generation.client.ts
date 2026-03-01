import type { GenerateRequest } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

function buildWav(pcmChunks: Uint8Array[], totalBytes: number, sampleRate: number): Blob {
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + totalBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + totalBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, totalBytes, true);
  const out = new Uint8Array(buffer, headerSize);
  let offset = 0;
  for (const chunk of pcmChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export const generationClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    async generate(request: GenerateRequest): Promise<Blob> {
      const response = await delegate.post<Response>('/generate/stream', request, { format: 'raw' });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Generation failed' }));
        throw new Error(error.message || `Generation failed (${response.status})`);
      }

      const contentType = response.headers.get('Content-Type') ?? '';

      // ElevenLabs and other non-PCM responses are returned as-is
      if (!contentType.includes('audio/pcm')) {
        return response.blob();
      }

      // PCM stream: accumulate chunks and build WAV
      const sampleRate = parseInt(response.headers.get('X-Sample-Rate') ?? '24000', 10);
      const body = response.body;
      if (!body) {
        throw new Error('No response body');
      }
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
        totalBytes += value.length;
      }

      return buildWav(chunks, totalBytes, sampleRate);
    },
  })),
);
