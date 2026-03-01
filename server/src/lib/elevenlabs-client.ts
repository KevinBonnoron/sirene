import type { PresetVoice } from '@sirene/shared';
import { getSetting } from './settings';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

export interface ElevenLabsRequest {
  text: string;
  voiceId: string;
  speed?: number;
  userId: string;
}

interface ElevenLabsVoiceResponse {
  voices: { voice_id: string; name: string; category: string }[];
}

export async function listElevenLabsVoices(userId: string): Promise<PresetVoice[]> {
  const apiKey = await getSetting('elevenlabs_api_key', userId);
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Go to Settings to add it.');
  }

  const response = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as ElevenLabsVoiceResponse;
  return data.voices.map((v) => {
    const match = v.name.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (match) {
      return { id: v.voice_id, label: match[1].trim(), description: match[2].trim() };
    }

    return { id: v.voice_id, label: v.name };
  });
}

export async function generateElevenLabs(request: ElevenLabsRequest): Promise<ArrayBuffer> {
  const apiKey = await getSetting('elevenlabs_api_key', request.userId);
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Go to Settings to add it.');
  }

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${request.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: request.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: request.speed ?? 1.0,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${body}`);
  }

  return response.arrayBuffer();
}
