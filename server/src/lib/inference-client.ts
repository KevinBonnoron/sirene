import type { CatalogModel } from '@sirene/shared';
import { config } from './config';

export interface InferenceRequest {
  backend: string;
  text: string;
  modelPath: string;
  voicePath?: string;
  referenceAudio?: string[];
  referenceAudioData?: string[]; // base64 data URIs, sent on cache miss retry
  referenceCacheKey?: string;
  referenceText?: string[];
  instructText?: string;
  instructGender?: string;
  speed?: number;
  /** Generation-level noise / variation. Only Piper consumes this today (maps to noise_scale). */
  noiseScale?: number;
  language?: string;
}

export class CacheMissError extends Error {
  public constructor() {
    super('Reference audio cache miss');
    this.name = 'CacheMissError';
  }
}

export interface StreamingAudioResponse {
  body: ReadableStream<Uint8Array>;
  sampleRate: number;
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

export async function installBackendDeps(backend: string): Promise<void> {
  try {
    const response = await fetch(`${config.inferenceUrl}/backends/${backend}/install`, {
      method: 'POST',
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min — torch can be slow
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backend install failed (${response.status}): ${body}`);
    }
  } catch (err) {
    // Non-fatal: inference server may be unavailable (e.g. API-only backends)
    console.warn(`Could not install deps for backend "${backend}":`, err);
  }
}

export async function getModels(): Promise<{ installed: string[]; custom: CatalogModel[] }> {
  try {
    const response = await fetch(`${config.inferenceUrl}/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { installed: [], custom: [] };
    }
    return response.json() as Promise<{ installed: string[]; custom: CatalogModel[] }>;
  } catch {
    return { installed: [], custom: [] };
  }
}

export async function deleteModel(modelId: string): Promise<void> {
  const response = await fetch(`${config.inferenceUrl}/models/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Delete model failed (${response.status}): ${body}`);
  }
}

export interface PullModelOptions {
  backend: string;
  modelId: string;
  files: { url: string; path: string }[];
  totalSize: number;
  hfToken?: string;
}

export async function* pullModel(options: PullModelOptions): AsyncGenerator<Record<string, unknown>> {
  const response = await fetch(`${config.inferenceUrl}/models/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      backend: options.backend,
      model_id: options.modelId,
      files: options.files,
      total_size: options.totalSize,
      hf_token: options.hfToken ?? null,
    }),
    signal: AbortSignal.timeout(60 * 60 * 1000), // 1 hour
  });

  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new Error(`Pull model failed (${response.status}): ${body}`);
  }

  const reader = response.body.getReader();
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
          yield JSON.parse(line.slice(6));
        } catch {
          // ignore malformed events
        }
      }
    }
  }
}

export async function importPiperModelToInference(formData: FormData): Promise<{ id: string; message: string }> {
  const response = await fetch(`${config.inferenceUrl}/models/piper/import`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ detail: response.statusText }))) as { detail?: string };
    const err = Object.assign(new Error(body.detail ?? 'Import failed'), { status: response.status });
    throw err;
  }
  return response.json() as Promise<{ id: string; message: string }>;
}

export async function fetchModelExport(modelId: string): Promise<Response> {
  return fetch(`${config.inferenceUrl}/models/${encodeURIComponent(modelId)}/export`, {
    signal: AbortSignal.timeout(60_000),
  });
}

export async function generateAudio(request: InferenceRequest): Promise<Buffer> {
  const response = await fetch(`${config.inferenceUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildInferenceBody(request)),
  });

  if (response.status === 412) {
    throw new CacheMissError();
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Inference failed (${response.status}): ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateAudioStream(request: InferenceRequest): Promise<StreamingAudioResponse> {
  const response = await fetch(`${config.inferenceUrl}/generate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildInferenceBody(request)),
  });

  if (response.status === 412) {
    throw new CacheMissError();
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Inference streaming failed (${response.status}): ${body}`);
  }

  if (!response.body) {
    throw new Error('No response body for streaming');
  }

  return {
    body: response.body as ReadableStream<Uint8Array>,
    sampleRate: Number(response.headers.get('X-Sample-Rate') ?? '24000'),
  };
}
