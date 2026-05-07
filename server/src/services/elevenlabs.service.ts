import type { PresetVoice } from '@sirene/shared';
import { BadRequestError } from '../errors';
import { elevenlabsRepository } from '../repositories';
import { settingsService } from './settings.service';

interface ElevenlabsGenerateParams {
  text: string;
  voiceId: string;
  speed?: number;
  userId: string;
}

class ElevenlabsService {
  public async generate({ text, voiceId, speed, userId }: ElevenlabsGenerateParams): Promise<ArrayBuffer> {
    const apiKey = await this.requireApiKey(userId);
    return elevenlabsRepository.createSpeech({ text, voiceId, speed, apiKey });
  }

  public async listVoices(userId: string): Promise<PresetVoice[]> {
    const apiKey = await this.requireApiKey(userId);
    return elevenlabsRepository.listVoices(apiKey);
  }

  private async requireApiKey(userId: string): Promise<string> {
    const apiKey = await settingsService.get('elevenlabs_api_key', userId);
    if (!apiKey) {
      throw new BadRequestError('ElevenLabs API key not configured. Go to Settings to add it.');
    }
    return apiKey;
  }
}

export const elevenlabsService = new ElevenlabsService();
