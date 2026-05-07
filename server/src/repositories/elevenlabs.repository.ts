import type { PresetVoice } from '@sirene/shared';
import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { UpstreamError } from '../errors';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

interface VoicesResponse {
  voices: { voice_id: string; name: string; category: string }[];
}

interface CreateSpeechParams {
  text: string;
  voiceId: string;
  speed?: number;
  apiKey: string;
}

function parseVoiceLabel(name: string): { label: string; description?: string } {
  // ElevenLabs encodes display info as "Name - description" / "Name – description".
  const match = name.match(/^(.+?)\s*[-–-]\s*(.+)$/);
  if (match?.[1] && match[2]) {
    return { label: match[1].trim(), description: match[2].trim() };
  }
  return { label: name };
}

async function explainError(response: Response, fallback: string): Promise<string> {
  const body = await response.text();
  return `${fallback} (${response.status}): ${body}`;
}

export const elevenlabsRepository = universalClient(
  withFetchDelegate(ELEVENLABS_BASE),
  withMethods(({ delegate }) => ({
    async listVoices(apiKey: string): Promise<PresetVoice[]> {
      const response = await delegate.get<Response>('/voices', {
        headers: { 'xi-api-key': apiKey },
        format: 'raw',
      });
      if (!response.ok) {
        throw new UpstreamError(await explainError(response, 'ElevenLabs API error'));
      }
      const data = (await response.json()) as VoicesResponse;
      return data.voices.map((v) => ({ id: v.voice_id, ...parseVoiceLabel(v.name) }));
    },

    async createSpeech({ text, voiceId, speed, apiKey }: CreateSpeechParams): Promise<ArrayBuffer> {
      const response = await delegate.post<Response>(
        `/text-to-speech/${voiceId}`,
        {
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: speed ?? 1.0,
          },
        },
        {
          headers: { 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
          format: 'raw',
        },
      );
      if (!response.ok) {
        throw new UpstreamError(await explainError(response, 'ElevenLabs API error'));
      }
      return response.arrayBuffer();
    },
  })),
);
