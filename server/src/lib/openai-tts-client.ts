import type { PresetVoice } from '@sirene/shared';
import { getSetting } from './settings';

const OPENAI_BASE = 'https://api.openai.com/v1';

export interface OpenAITTSRequest {
  text: string;
  voiceId: string;
  model?: 'tts-1' | 'tts-1-hd';
  speed?: number;
  userId: string;
}

const OPENAI_VOICES: PresetVoice[] = [
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

export function listOpenAIVoices(): PresetVoice[] {
  return OPENAI_VOICES;
}

export async function generateOpenAI(request: OpenAITTSRequest): Promise<ArrayBuffer> {
  const apiKey = await getSetting('openai_api_key', request.userId);
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Go to Settings to add it.');
  }

  const response = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model ?? 'tts-1',
      input: request.text,
      voice: request.voiceId,
      speed: Math.min(Math.max(request.speed ?? 1.0, 0.25), 4.0),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    try {
      const json = JSON.parse(body);
      throw new Error(json?.error?.message ?? `OpenAI TTS error (${response.status})`);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`OpenAI TTS error (${response.status}): ${body}`);
      }
      throw e;
    }
  }

  return response.arrayBuffer();
}
