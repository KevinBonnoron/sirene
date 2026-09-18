import type { GenerateRequest, GenerationAlignment } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';
import { closePlaybackContext, createPcmPlayer, openPlaybackContext } from '@/lib/pcm-player';

export interface GenerateResult {
  generationId: string | null;
}

export const generationClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    async generate(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
      // Opened before the request: a context created after the await is still suspended on
      // Safari. A player takes it over; every other path closes it in the finally, because
      // browsers cap how many can be open and a run of failures would end in silence.
      const context = openPlaybackContext();
      let player: ReturnType<typeof createPcmPlayer> = null;
      try {
        const response = await delegate.post<Response>('/generate/stream', request, { format: 'raw', signal });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Generation failed' }));
          throw new Error(error.message || `Generation failed (${response.status})`);
        }

        const generationId = response.headers.get('X-Generation-Id');
        const sampleRate = Number.parseInt(response.headers.get('X-Sample-Rate') ?? '', 10);
        const body = response.body;
        if (!body) {
          return { generationId };
        }

        // No sample rate means a buffered response: a cloud provider returns a finished file
        // rather than a stream. It still has to be read to the end for the request to
        // complete, which the same loop does without a player.
        if (context && Number.isFinite(sampleRate) && sampleRate > 0) {
          player = createPcmPlayer(context, sampleRate);
        }

        const reader = body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            player?.push(value);
          }
        } catch (err) {
          player?.stop();
          throw err;
        }
        // Deliberately not awaited: the take is generated once the stream ends, and holding
        // the caller until the audio finishes would delay adding it to the session.
        player?.endOfStream();
        return { generationId };
      } finally {
        // A player closes the context itself, on stop or once playback drains.
        if (context && !player) {
          closePlaybackContext(context);
        }
      }
    },

    align(id: string): Promise<GenerationAlignment> {
      return delegate.get<GenerationAlignment>(`/generations/${id}/align`);
    },
  })),
);
