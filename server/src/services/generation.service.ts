import { createHash } from 'node:crypto';
import type { Generation, GenerationAlignment, WordAlignment } from '@sirene/shared';
import { buildWav, readPcmStream } from '@sirene/shared';
import { config } from '../lib/config';
import { pickTarget } from '../lib/inference-router';
import { pb } from '../lib/pocketbase';
import { CacheMissError, generationRepository, type InferenceRequest, inferenceRepository, voiceRepository, voiceSampleRepository } from '../repositories';
import { elevenlabsService } from './elevenlabs.service';
import { modelService } from './model.service';
import { openAITtsService } from './openai-tts.service';
import { BadRequestError, NotFoundError } from './service-error';

export interface ListGenerationsFilter {
  voice?: string;
  model?: string;
}

export interface GenerationTuningInput {
  pitchShift?: number;
  speedMultiplier?: number;
  variationSeed?: number;
}

export interface GenerateInput {
  voice: string;
  input: string;
  speed?: number;
  tuning?: GenerationTuningInput;
  editorContent?: Record<string, unknown>;
}

interface GenerationMeta {
  voice: string;
  model: string;
  text: string;
  language: string;
  speed: number;
  user: string;
  tuning?: GenerationTuningInput;
  editorContent?: Record<string, unknown>;
}

interface VoiceSampleRef {
  id: string;
  audio: string;
}

type ResolvedGeneration = { type: 'inference'; inferenceRequest: InferenceRequest; meta: GenerationMeta; samples?: VoiceSampleRef[] } | { type: 'elevenlabs'; voiceId: string; speed: number; meta: GenerationMeta } | { type: 'openai'; voiceId: string; speed: number; meta: GenerationMeta };

export interface BufferedGeneration {
  type: 'buffered';
  generationId: string;
  audio: ArrayBuffer | Buffer;
  contentType: string;
}

export interface StreamingGeneration {
  type: 'streaming';
  generationId: string;
  stream: ReadableStream<Uint8Array>;
  sampleRate: number;
}

class GenerationService {
  public async listForUser(userId: string, filter: ListGenerationsFilter): Promise<Generation[]> {
    const filters = [`user = "${userId}"`];
    if (filter.voice) {
      filters.push(`voice = "${filter.voice}"`);
    }
    if (filter.model) {
      filters.push(`model = "${filter.model}"`);
    }
    return generationRepository.getAllBy(filters.join(' && ')) as Promise<Generation[]>;
  }

  public async getById(id: string): Promise<Generation> {
    const generation = (await generationRepository.getOne(id)) as Generation | null;
    if (!generation) {
      throw new NotFoundError('Generation not found');
    }
    return generation;
  }

  /** Word-level alignment for a generation. Today this is a uniform stub
   *  (each word gets `duration / N` seconds); will be replaced by whisperx /
   *  MFA / model-native timestamps. */
  public async getAlignment(id: string, userId: string): Promise<GenerationAlignment> {
    const generation = (await generationRepository.getOne(id)) as Generation | null;
    if (!generation || generation.user !== userId) {
      throw new NotFoundError('Generation not found');
    }
    return stubAlign(generation.text ?? '', generation.duration ?? 0, id);
  }

  public async delete(id: string): Promise<void> {
    await generationRepository.delete(id);
  }

  /** Buffered generation: pre-creates the PB record, runs the matching backend,
   *  attaches the audio file, and returns a result the route wraps in a Response.
   *  Failures clean up the placeholder so we don't leak orphan rows. */
  public async generateBuffered(body: GenerateInput, userId: string): Promise<BufferedGeneration> {
    const resolved = await this.resolve(body, userId);
    resolved.meta.user = userId;
    const generationId = await this.preCreate(resolved.meta);

    try {
      if (resolved.type === 'elevenlabs') {
        const audio = await elevenlabsService.generate({ text: resolved.meta.text, voiceId: resolved.voiceId, speed: resolved.speed, userId });
        await this.finalize(generationId, audio, 'audio/mpeg', 'generation.mp3', 0);
        return { type: 'buffered', generationId, audio, contentType: 'audio/mpeg' };
      }
      if (resolved.type === 'openai') {
        const audio = await openAITtsService.generate({ text: resolved.meta.text, voiceId: resolved.voiceId, speed: resolved.speed, userId });
        await this.finalize(generationId, audio, 'audio/mpeg', 'generation.mp3', 0);
        return { type: 'buffered', generationId, audio, contentType: 'audio/mpeg' };
      }

      const audio = await this.runInference(resolved);
      await this.finalize(generationId, audio, 'audio/wav', 'generation.wav', 0);
      return { type: 'buffered', generationId, audio, contentType: 'audio/wav' };
    } catch (err) {
      await this.cleanup(generationId);
      throw err;
    }
  }

  /** Streaming generation: cloud backends (ElevenLabs / OpenAI) fall back to a
   *  buffered response since their APIs aren't streaming-friendly. The local
   *  inference path returns a tee'd PCM stream -- one branch flows to the client,
   *  the other persists as WAV in the background. */
  public async generateStreaming(body: GenerateInput, userId: string): Promise<BufferedGeneration | StreamingGeneration> {
    const resolved = await this.resolve(body, userId);
    resolved.meta.user = userId;
    const generationId = await this.preCreate(resolved.meta);

    try {
      if (resolved.type === 'elevenlabs') {
        const audio = await elevenlabsService.generate({ text: resolved.meta.text, voiceId: resolved.voiceId, speed: resolved.speed, userId });
        await this.finalize(generationId, audio, 'audio/mpeg', 'generation.mp3', 0);
        return { type: 'buffered', generationId, audio, contentType: 'audio/mpeg' };
      }
      if (resolved.type === 'openai') {
        const audio = await openAITtsService.generate({ text: resolved.meta.text, voiceId: resolved.voiceId, speed: resolved.speed, userId });
        await this.finalize(generationId, audio, 'audio/mpeg', 'generation.mp3', 0);
        return { type: 'buffered', generationId, audio, contentType: 'audio/mpeg' };
      }

      const target = await pickTarget({ requireModel: resolved.inferenceRequest.modelPath });
      const repo = inferenceRepository(target);
      const upstream = await repo.generateStream(resolved.inferenceRequest).catch(async (e) => {
        if (!(e instanceof CacheMissError) || !resolved.samples) {
          throw e;
        }
        const audioData = await this.fetchSamplesAsBase64(resolved.samples);
        return repo.generateStream({ ...resolved.inferenceRequest, referenceAudioData: audioData });
      });

      // tee() splits the stream so we can both serve it to the client and persist a copy.
      // Python sends keepalive silence on non-streaming backends, so this fetch returns
      // within ~30s and data flows continuously after.
      const [clientStream, saveStream] = upstream.body.tee();

      this.accumulateAndSave(saveStream, upstream.sampleRate, generationId).catch(async (err) => {
        console.error('[generate/stream] Failed to save generation:', err);
        await this.cleanup(generationId);
      });

      return { type: 'streaming', generationId, stream: clientStream, sampleRate: upstream.sampleRate };
    } catch (err) {
      await this.cleanup(generationId);
      throw err;
    }
  }

  private async resolve(body: GenerateInput, userId: string): Promise<ResolvedGeneration> {
    const voice = await voiceRepository.getOne(body.voice);
    if (!voice) {
      throw new NotFoundError('Voice not found');
    }
    if (!voice.model) {
      throw new BadRequestError('Voice has no model assigned');
    }

    const fullCatalog = await modelService.getFullCatalog(userId);
    const catalog = fullCatalog.find((m) => m.id === voice.model);
    if (!catalog) {
      throw new NotFoundError(`Model "${voice.model}" not found in catalog`);
    }

    if (!(await modelService.isModelInstalled(catalog))) {
      throw new BadRequestError(`Model "${catalog.name}" is not installed`);
    }

    const options = (voice.options ?? {}) as Record<string, unknown>;
    const language = voice.language || 'en';
    const effectiveSpeed = body.tuning?.speedMultiplier ?? body.speed ?? 1;
    // Map variationSeed (0..1, 0.5 default) to Piper's noise_scale (0.4..0.95).
    // Other backends ignore the value -- see `getVoiceCapabilities` on the shared
    // side for what's actually wired.
    const noiseScale = catalog.backend === 'piper' && typeof body.tuning?.variationSeed === 'number' ? 0.4 + Math.max(0, Math.min(1, body.tuning.variationSeed)) * 0.55 : undefined;

    const meta: GenerationMeta = {
      voice: body.voice,
      model: voice.model,
      text: body.input,
      language,
      speed: effectiveSpeed,
      user: '',
      tuning: body.tuning,
      editorContent: body.editorContent,
    };

    if (catalog.backend === 'elevenlabs') {
      const voiceId = options.presetVoice as string;
      if (!voiceId) {
        throw new BadRequestError('ElevenLabs voice requires a preset voice ID. Edit the voice and select one.');
      }
      return { type: 'elevenlabs', voiceId, speed: effectiveSpeed, meta };
    }

    if (catalog.backend === 'openai') {
      const voiceId = options.presetVoice as string;
      if (!voiceId) {
        throw new BadRequestError('OpenAI TTS voice requires a preset voice ID. Edit the voice and select one.');
      }
      return { type: 'openai', voiceId, speed: effectiveSpeed, meta };
    }

    const modelPath = catalog.id;
    const presetVoice = catalog.types.includes('preset') ? (options.presetVoice as string | undefined) : undefined;

    if (catalog.types.includes('cloning') && !presetVoice) {
      const rows = await voiceSampleRepository.getAllBy(`voice = "${body.voice}" && enabled = true`, { sort: 'order,created' });
      if (rows.length === 0) {
        throw new BadRequestError('Voice cloning requires at least one enabled audio sample. Edit the voice to upload or enable a sample.');
      }
      const samples: VoiceSampleRef[] = rows.map((s) => ({ id: s.id, audio: s.audio as string }));
      const cacheKey = createHash('sha256')
        .update(
          samples
            .map((s) => s.id)
            .sort()
            .join(','),
        )
        .digest('hex')
        .slice(0, 24);
      const referenceText = rows.map((s) => (s.transcript as string) || '');

      return {
        type: 'inference',
        inferenceRequest: {
          backend: catalog.backend,
          text: body.input,
          modelPath,
          referenceCacheKey: cacheKey,
          referenceText,
          speed: effectiveSpeed,
          noiseScale,
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
        voicePath: presetVoice,
        speed: effectiveSpeed,
        noiseScale,
        language,
      },
      meta,
    };
  }

  private async runInference(resolved: ResolvedGeneration & { type: 'inference' }): Promise<Buffer> {
    const target = await pickTarget({ requireModel: resolved.inferenceRequest.modelPath });
    const repo = inferenceRepository(target);
    try {
      return await repo.generate(resolved.inferenceRequest);
    } catch (err) {
      if (!(err instanceof CacheMissError) || !resolved.samples) {
        throw err;
      }
      const audioData = await this.fetchSamplesAsBase64(resolved.samples);
      return repo.generate({ ...resolved.inferenceRequest, referenceAudioData: audioData });
    }
  }

  private async fetchSamplesAsBase64(samples: VoiceSampleRef[]): Promise<string[]> {
    return Promise.all(
      samples.map(async (s) => {
        const url = `${config.pb.url}/api/files/voice_samples/${s.id}/${s.audio}`;
        const response = await fetch(url, { headers: { Authorization: pb.authStore.token } });
        if (!response.ok) {
          throw new Error(`Failed to fetch voice sample ${s.id}: ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const ext = s.audio.split('.').pop() ?? 'wav';
        const mime = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`;
        return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
      }),
    );
  }

  private async preCreate(meta: GenerationMeta): Promise<string> {
    const record = await generationRepository.create({
      voice: meta.voice,
      model: meta.model,
      text: meta.text,
      language: meta.language,
      speed: meta.speed,
      user: meta.user,
      state: 'ready',
      tuning: meta.tuning ?? null,
      editorContent: meta.editorContent ?? null,
    });
    return record.id;
  }

  private async finalize(generationId: string, audio: ArrayBuffer | Buffer, contentType: string, filename: string, duration: number) {
    const formData = new FormData();
    formData.append('duration', String(Math.round(duration)));
    formData.append('audio', new Blob([audio], { type: contentType }), filename);
    await generationRepository.update(generationId, formData);
  }

  private async accumulateAndSave(stream: ReadableStream<Uint8Array>, sampleRate: number, generationId: string) {
    const { chunks, totalBytes } = await readPcmStream(stream);
    if (totalBytes === 0) {
      return;
    }
    const wavBuffer = buildWav(chunks, totalBytes, sampleRate);
    const duration = totalBytes / (2 * sampleRate);
    await this.finalize(generationId, wavBuffer, 'audio/wav', 'generation.wav', duration);
  }

  private async cleanup(generationId: string) {
    try {
      await generationRepository.delete(generationId);
    } catch (err) {
      console.error('[generation] Failed to clean up placeholder generation:', err);
    }
  }
}

function splitWords(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function stubAlign(text: string, duration: number, generationId: string): GenerationAlignment {
  const words = splitWords(text);
  if (words.length === 0 || duration <= 0) {
    return { generationId, duration, words: [], stubbed: true };
  }
  const step = duration / words.length;
  const aligned: WordAlignment[] = words.map((w, i) => ({
    index: i,
    text: w,
    start: i * step,
    end: (i + 1) * step,
  }));
  return { generationId, duration, words: aligned, stubbed: true };
}

export const generationService = new GenerationService();
