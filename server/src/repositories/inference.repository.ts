import type { CatalogModel } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { CacheMissError, UpstreamError } from '../errors';
import type { InferenceRequest, InferenceTarget, PullModelOptions, StreamingAudioResponse } from '../types';

function authHeaders(target: InferenceTarget): Record<string, string> {
  return target.authToken ? { Authorization: `Bearer ${target.authToken}` } : {};
}

/** Log the upstream body server-side and throw an `UpstreamError` carrying a
 *  generic, client-safe message. The route layer eventually serializes
 *  `ServiceError.message` to the API consumer, and raw worker payloads can
 *  contain backend tracebacks, internal paths, or model identifiers that
 *  shouldn't escape the trust boundary. */
async function throwUpstream(op: string, response: Response): Promise<never> {
  const body = await response.text().catch(() => '');
  console.warn(`[inference/${op}] upstream ${response.status}`, { status: response.status, body });
  throw new UpstreamError('upstream.inference', `${op} failed (HTTP ${response.status})`);
}

function buildInferenceBody(request: InferenceRequest) {
  return {
    backend: request.backend,
    text: request.text,
    model_path: request.modelPath,
    voice_path: request.voicePath ?? null,
    reference_audio: request.referenceAudio ?? null,
    reference_audio_data: request.referenceAudioData ?? null,
    reference_cache_key: request.referenceCacheKey ?? null,
    reference_text: request.referenceText ?? null,
    instruct_text: request.instructText ?? null,
    instruct_gender: request.instructGender ?? null,
    speed: request.speed ?? 1.0,
    noise_scale: request.noiseScale ?? null,
    language: request.language ?? 'en',
  };
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6)) as Record<string, unknown>;
        } catch {
          // ignore malformed events
        }
      }
    }
  }
}

/** Inference workers come and go; the router gives us a fresh `InferenceTarget`
 *  per call (least-loaded among healthy ones), so this repository is a
 *  *factory*: callers get a typed client bound to that one worker. */
export function inferenceRepository(target: InferenceTarget) {
  const headers = authHeaders(target);

  return universalClient(
    withFetchDelegate(target.url),
    withMethods(({ delegate }) => ({
      async listModels(): Promise<{ installed: string[]; custom: CatalogModel[] }> {
        // Throws on transport / non-OK so callers can distinguish a genuinely empty
        // worker from a transient probe failure.
        const response = await delegate.get<Response>('/models', {
          headers,
          format: 'raw',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          await throwUpstream('listModels', response);
        }
        return response.json() as Promise<{ installed: string[]; custom: CatalogModel[] }>;
      },

      async deleteModel(modelId: string): Promise<void> {
        const response = await delegate.delete<Response>(`/models/${encodeURIComponent(modelId)}`, {
          headers,
          format: 'raw',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          await throwUpstream('deleteModel', response);
        }
      },

      /** Returns the raw upstream Response so the route can stream the zip body
       *  through to the client without buffering. */
      async fetchExport(modelId: string): Promise<Response> {
        return delegate.get<Response>(`/models/${encodeURIComponent(modelId)}/export`, {
          headers,
          format: 'raw',
          signal: AbortSignal.timeout(60_000),
        });
      },

      async *pullModel(options: PullModelOptions): AsyncGenerator<Record<string, unknown>> {
        const response = await delegate.post<Response>(
          '/models/pull',
          {
            backend: options.backend,
            model_id: options.modelId,
            files: options.files,
            total_size: options.totalSize,
            hf_token: options.hfToken ?? null,
          },
          {
            headers,
            format: 'raw',
            signal: AbortSignal.timeout(60 * 60 * 1000), // 1 hour
          },
        );
        if (!response.ok || !response.body) {
          await throwUpstream('pullModel', response);
        }
        yield* parseSseStream(response.body as ReadableStream<Uint8Array>);
      },

      async importPiperModel(formData: FormData): Promise<{ id: string; message: string }> {
        const response = await delegate.post<Response>('/models/piper/import', formData, {
          headers,
          format: 'raw',
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          // Log the upstream detail server-side, but keep the user-facing
          // message generic. The status hint stays on the thrown error for
          // the route layer to map if needed.
          const body = (await response.json().catch(() => ({}))) as { detail?: string };
          console.warn('[inference/importPiperModel] upstream', { status: response.status, detail: body.detail });
          const err = Object.assign(new UpstreamError('upstream.inference', `Piper import failed (HTTP ${response.status})`), { status: response.status });
          throw err;
        }
        return response.json() as Promise<{ id: string; message: string }>;
      },

      async generate(request: InferenceRequest): Promise<Buffer> {
        const response = await delegate.post<Response>('/generate', buildInferenceBody(request), {
          headers,
          format: 'raw',
        });
        if (response.status === 412) {
          throw new CacheMissError();
        }
        if (!response.ok) {
          await throwUpstream('generate', response);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      },

      async generateStream(request: InferenceRequest): Promise<StreamingAudioResponse> {
        const response = await delegate.post<Response>('/generate/stream', buildInferenceBody(request), {
          headers,
          format: 'raw',
        });
        if (response.status === 412) {
          throw new CacheMissError();
        }
        if (!response.ok) {
          await throwUpstream('generateStream', response);
        }
        if (!response.body) {
          throw new UpstreamError('upstream.inference', 'No response body for streaming');
        }
        return {
          body: response.body as ReadableStream<Uint8Array>,
          sampleRate: Number(response.headers.get('X-Sample-Rate') ?? '24000'),
        };
      },

      /** Forwards a raw upload to the worker (used by transcribe). The caller
       *  knows the FormData layout; this just adds auth + a long timeout. */
      async transcribe(formData: FormData, signal?: AbortSignal): Promise<{ text: string; language?: string }> {
        const response = await delegate.post<Response>('/transcribe', formData, {
          headers,
          format: 'raw',
          signal,
        });
        if (!response.ok) {
          await throwUpstream('transcribe', response);
        }
        return response.json() as Promise<{ text: string; language?: string }>;
      },

      /** Liveness probe used by the health loop. Returns the parsed body on 2xx,
       *  throws UpstreamError on transport errors or non-2xx so the caller can
       *  decide between 'offline' and 'online' from a single try/catch. */
      async health(): Promise<unknown> {
        const response = await delegate.get<Response>('/health', {
          headers,
          format: 'raw',
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          throw new UpstreamError('upstream.inference', `HTTP ${response.status}`);
        }
        return response.json().catch(() => ({}));
      },
    })),
  );
}
