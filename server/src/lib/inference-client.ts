import { config } from './config';

export interface InferenceRequest {
  backend: string;
  text: string;
  modelPath: string;
  voicePath?: string;
  referenceAudio?: string[];
  referenceText?: string[];
  instructText?: string;
  instructGender?: string;
  speed?: number;
  language?: string;
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
    reference_text: request.referenceText ?? null,
    instruct_text: request.instructText ?? null,
    instruct_gender: request.instructGender ?? null,
    speed: request.speed ?? 1.0,
    language: request.language ?? 'en',
  };
}

export async function generateAudio(request: InferenceRequest): Promise<Buffer> {
  const response = await fetch(`${config.inferenceUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildInferenceBody(request)),
  });

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
