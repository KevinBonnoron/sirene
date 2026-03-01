import { createHash } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../lib/config';
import { type ElevenLabsRequest, generateElevenLabs } from '../lib/elevenlabs-client';
import { CacheMissError, generateAudio, generateAudioStream, type InferenceRequest } from '../lib/inference-client';
import { type OpenAITTSRequest, generateOpenAI } from '../lib/openai-tts-client';
import { pb } from '../lib/pocketbase';
import type { AuthEnv } from '../middleware';
import { generationRepository, voiceRepository, voiceSampleRepository } from '../repositories';
import { modelService } from '../services';

const generateSchema = z.object({
  voice: z.string().min(1),
  input: z.string().min(1),
  speed: z.number().min(0.1).max(5).optional(),
});

type VoiceSample = { id: string; audio: string };

type ResolvedGeneration =
  | { type: 'inference'; inferenceRequest: InferenceRequest; meta: GenerationMeta; samples?: VoiceSample[] }
  | { type: 'elevenlabs'; elevenLabsRequest: ElevenLabsRequest; meta: GenerationMeta }
  | { type: 'openai'; openAIRequest: OpenAITTSRequest; meta: GenerationMeta };

interface GenerationMeta {
  voice: string;
  model: string;
  text: string;
  language: string;
  speed: number;
  user: string;
}

async function resolveGeneration(body: z.infer<typeof generateSchema>, userId: string): Promise<ResolvedGeneration | Response> {
  const voice = await voiceRepository.getOne(body.voice);
  if (!voice) {
    return Response.json({ message: 'Voice not found' }, { status: 404 });
  }

  if (!voice.model) {
    return Response.json({ message: 'Voice has no model assigned' }, { status: 400 });
  }

  const fullCatalog = await modelService.getFullCatalog(userId);
  const catalog = fullCatalog.find((m) => m.id === voice.model);
  if (!catalog) {
    return Response.json({ message: `Model "${voice.model}" not found in catalog` }, { status: 404 });
  }

  if (!(await modelService.isModelInstalled(catalog))) {
    return Response.json({ message: `Model "${catalog.name}" is not installed` }, { status: 400 });
  }

  const options = (voice.options ?? {}) as Record<string, unknown>;
  const language = voice.language || 'en';
  const meta: GenerationMeta = { voice: body.voice, model: voice.model, text: body.input, language, speed: body.speed || 1, user: '' };

  // ElevenLabs — direct API call, no inference service
  if (catalog.backend === 'elevenlabs') {
    const voiceId = options.presetVoice as string;
    if (!voiceId) {
      return Response.json({ message: 'ElevenLabs voice requires a preset voice ID. Edit the voice and select one.' }, { status: 400 });
    }
    return { type: 'elevenlabs', elevenLabsRequest: { text: body.input, voiceId, speed: body.speed, userId }, meta };
  }

  // OpenAI TTS — direct API call, no inference service
  if (catalog.backend === 'openai') {
    const voiceId = options.presetVoice as string;
    if (!voiceId) {
      return Response.json({ message: 'OpenAI TTS voice requires a preset voice ID. Edit the voice and select one.' }, { status: 400 });
    }
    return { type: 'openai', openAIRequest: { text: body.input, voiceId, speed: body.speed, userId }, meta };
  }

  const modelPath = catalog.id;

  let referenceAudio: string[] | undefined;
  let referenceText: string[] | undefined;

  let samples: VoiceSample[] | undefined;

  if (catalog.types.includes('cloning')) {
    const rows = await voiceSampleRepository.getAllBy(`voice = "${body.voice}" && enabled = true`, { sort: 'order,created' });
    if (rows.length === 0) {
      return Response.json({ message: 'Voice cloning requires at least one enabled audio sample. Edit the voice to upload or enable a sample.' }, { status: 400 });
    }

    samples = rows.map((s) => ({ id: s.id, audio: s.audio as string }));
    const cacheKey = createHash('sha256').update(samples.map((s) => s.id).sort().join(',')).digest('hex').slice(0, 24);
    referenceText = rows.map((s) => (s.transcript as string) || '');

    return {
      type: 'inference',
      inferenceRequest: {
        backend: catalog.backend,
        text: body.input,
        modelPath,
        voicePath: catalog.types.includes('preset') ? (options.presetVoice as string) : undefined,
        referenceCacheKey: cacheKey,
        referenceText,
        speed: body.speed,
        language,
      },
      meta,
      samples,
    };
  }

  return {
    type: 'inference',
    inferenceRequest: {
      backend: catalog.backend,
      text: body.input,
      modelPath,
      voicePath: catalog.types.includes('preset') ? (options.presetVoice as string) : undefined,
      referenceAudio,
      referenceText,
      speed: body.speed,
      language,
    },
    meta,
  };
}

async function fetchSamplesAsBase64(samples: VoiceSample[]): Promise<string[]> {
  return Promise.all(
    samples.map(async (s) => {
      const url = `${config.pb.url}/api/files/voice_samples/${s.id}/${s.audio}`;
      const response = await fetch(url, { headers: { Authorization: pb.authStore.token } });
      if (!response.ok) { throw new Error(`Failed to fetch voice sample ${s.id}: ${response.status}`); }
      const buffer = await response.arrayBuffer();
      const ext = s.audio.split('.').pop() ?? 'wav';
      const mime = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`;
      return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
    }),
  );
}

function buildWav(chunks: Uint8Array[], totalBytes: number, sampleRate: number): ArrayBuffer {
  const headerSize = 44;
  const wav = new ArrayBuffer(headerSize + totalBytes);
  const view = new DataView(wav);

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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, totalBytes, true);

  const out = new Uint8Array(wav, headerSize);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return wav;
}

async function accumulateAndSave(stream: ReadableStream<Uint8Array>, sampleRate: number, meta: GenerationMeta) {
  const reader = stream.getReader();
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

  if (totalBytes === 0) {
    return;
  }

  const wavBuffer = buildWav(chunks, totalBytes, sampleRate);
  const duration = totalBytes / (2 * sampleRate);

  const formData = new FormData();
  formData.append('voice', meta.voice);
  formData.append('model', meta.model);
  formData.append('text', meta.text);
  formData.append('language', meta.language);
  formData.append('duration', String(Math.round(duration)));
  formData.append('speed', String(meta.speed));
  formData.append('user', meta.user);
  formData.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), 'generation.wav');

  await generationRepository.create(formData);
}

async function saveGeneration(meta: GenerationMeta, audio: ArrayBuffer | Buffer, contentType: string, filename: string) {
  const formData = new FormData();
  formData.append('voice', meta.voice);
  formData.append('model', meta.model);
  formData.append('text', meta.text);
  formData.append('language', meta.language);
  formData.append('duration', '0');
  formData.append('speed', String(meta.speed));
  formData.append('user', meta.user);
  formData.append('audio', new Blob([audio], { type: contentType }), filename);
  await generationRepository.create(formData);
}

export const generateRoutes = new Hono<AuthEnv>()
  .post('', zValidator('json', generateSchema), async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    const resolved = await resolveGeneration(body, userId);
    if (resolved instanceof Response) {
      return resolved;
    }
    resolved.meta.user = userId;

    if (resolved.type === 'elevenlabs') {
      try {
        const audioBuffer = await generateElevenLabs(resolved.elevenLabsRequest);
        await saveGeneration(resolved.meta, audioBuffer, 'audio/mpeg', 'generation.mp3');
        return new Response(audioBuffer, { headers: { 'Content-Type': 'audio/mpeg' } });
      } catch (e) {
        return c.json({ message: e instanceof Error ? e.message : 'ElevenLabs generation failed' }, 502);
      }
    }

    if (resolved.type === 'openai') {
      try {
        const audioBuffer = await generateOpenAI(resolved.openAIRequest);
        await saveGeneration(resolved.meta, audioBuffer, 'audio/mpeg', 'generation.mp3');
        return new Response(audioBuffer, { headers: { 'Content-Type': 'audio/mpeg' } });
      } catch (e) {
        return c.json({ message: e instanceof Error ? e.message : 'OpenAI TTS generation failed' }, 502);
      }
    }

    try {
      const audioBuffer = await generateAudio(resolved.inferenceRequest);
      await saveGeneration(resolved.meta, audioBuffer, 'audio/wav', 'generation.wav');
      return new Response(audioBuffer, { headers: { 'Content-Type': 'audio/wav' } });
    } catch (e) {
      if (!(e instanceof CacheMissError) || !resolved.samples) { throw e; }
      const audioData = await fetchSamplesAsBase64(resolved.samples);
      const audioBuffer = await generateAudio({ ...resolved.inferenceRequest, referenceAudioData: audioData });
      await saveGeneration(resolved.meta, audioBuffer, 'audio/wav', 'generation.wav');
      return new Response(audioBuffer, { headers: { 'Content-Type': 'audio/wav' } });
    }
  })
  .post('/stream', zValidator('json', generateSchema), async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    const resolved = await resolveGeneration(body, userId);
    if (resolved instanceof Response) {
      return resolved;
    }
    resolved.meta.user = userId;

    // ElevenLabs: fall back to non-streaming
    if (resolved.type === 'elevenlabs') {
      try {
        const audioBuffer = await generateElevenLabs(resolved.elevenLabsRequest);
        await saveGeneration(resolved.meta, audioBuffer, 'audio/mpeg', 'generation.mp3');
        return new Response(audioBuffer, { headers: { 'Content-Type': 'audio/mpeg' } });
      } catch (e) {
        return c.json({ message: e instanceof Error ? e.message : 'ElevenLabs generation failed' }, 502);
      }
    }

    // OpenAI TTS: fall back to non-streaming
    if (resolved.type === 'openai') {
      try {
        const audioBuffer = await generateOpenAI(resolved.openAIRequest);
        await saveGeneration(resolved.meta, audioBuffer, 'audio/mpeg', 'generation.mp3');
        return new Response(audioBuffer, { headers: { 'Content-Type': 'audio/mpeg' } });
      } catch (e) {
        return c.json({ message: e instanceof Error ? e.message : 'OpenAI TTS generation failed' }, 502);
      }
    }

    // Python now sends keepalive silence for non-streaming backends,
    // so this fetch returns within ~30s and data flows continuously.
    try {
      const streamResponse = await generateAudioStream(resolved.inferenceRequest).catch(async (e) => {
        if (!(e instanceof CacheMissError) || !resolved.samples) { throw e; }
        const audioData = await fetchSamplesAsBase64(resolved.samples);
        return generateAudioStream({ ...resolved.inferenceRequest, referenceAudioData: audioData });
      });
      const [clientStream, saveStream] = streamResponse.body.tee();

      accumulateAndSave(saveStream, streamResponse.sampleRate, resolved.meta).catch((err) => console.error('[generate/stream] Failed to save generation:', err));

      return new Response(clientStream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Sample-Rate': String(streamResponse.sampleRate),
          'X-Channels': '1',
          'X-Bits-Per-Sample': '16',
        },
      });
    } catch (e) {
      return c.json({ message: e instanceof Error ? e.message : 'Generation failed' }, 500);
    }
  });
