import type { PresetVoice } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { UpstreamError } from '../errors';

const OPENAI_BASE = 'https://api.openai.com/v1';

export const OPENAI_VOICES: PresetVoice[] = [
  { id: 'alloy', label: 'Alloy', description: 'Neutral and balanced' },
  { id: 'ash', label: 'Ash', description: 'Warm and conversational' },
  { id: 'ballad', label: 'Ballad', description: 'Gentle and expressive' },
  { id: 'coral', label: 'Coral', description: 'Bright and optimistic' },
  { id: 'echo', label: 'Echo', description: 'Deep and resonant' },
  { id: 'fable', label: 'Fable', description: 'Engaging storyteller' },
  { id: 'nova', label: 'Nova', description: 'Clear and energetic' },
  { id: 'onyx', label: 'Onyx', description: 'Rich and authoritative' },
  { id: 'sage', label: 'Sage', description: 'Calm and measured' },
  { id: 'shimmer', label: 'Shimmer', description: 'Soft and warm' },
  { id: 'verse', label: 'Verse', description: 'Versatile and expressive' },
];

interface CreateSpeechParams {
  text: string;
  voice: string;
  model?: 'tts-1' | 'tts-1-hd';
  speed?: number;
  apiKey: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export const openAITtsRepository = universalClient(
  withFetchDelegate(OPENAI_BASE),
  withMethods(({ delegate }) => ({
    async createSpeech({ text, voice, model = 'tts-1', speed = 1, apiKey }: CreateSpeechParams): Promise<ArrayBuffer> {
      // format: 'raw' so we can read OpenAI's nested error envelope (`error.message`)
      // before raising. The default auto-throw only checks top-level `.error` / `.message`.
      const response = await delegate.post<Response>(
        '/audio/speech',
        {
          model,
          input: text,
          voice,
          speed: clamp(speed, 0.25, 4),
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          format: 'raw',
        },
      );
      if (!response.ok) {
        const body = await response.text();
        const parsed = (() => {
          try {
            return JSON.parse(body) as { error?: { message?: string } };
          } catch {
            return null;
          }
        })();
        const message = parsed?.error?.message ?? `OpenAI TTS error (${response.status}): ${body}`;
        throw new UpstreamError(message);
      }
      return response.arrayBuffer();
    },

    listVoices(): PresetVoice[] {
      return OPENAI_VOICES;
    },
  })),
);
