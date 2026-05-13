import type { PresetVoice } from '@sirene/shared';
import { BadRequestError } from '../errors';
import { openAITtsRepository } from '../repositories';
import { settingsService } from './settings.service';

interface OpenAITtsGenerateParams {
  text: string;
  voiceId: string;
  speed?: number;
  userId: string;
}

class OpenAITtsService {
  public async generate({ text, voiceId, speed, userId }: OpenAITtsGenerateParams): Promise<ArrayBuffer> {
    const apiKey = await this.requireApiKey(userId);
    return openAITtsRepository.createSpeech({ text, voice: voiceId, speed, apiKey });
  }

  public listVoices(): PresetVoice[] {
    return openAITtsRepository.listVoices();
  }

  private async requireApiKey(userId: string): Promise<string> {
    const apiKey = await settingsService.get('openai_api_key', userId);
    if (!apiKey) {
      throw new BadRequestError('openai.keyNotConfigured', 'OpenAI API key not configured. Go to Settings to add it.');
    }
    return apiKey;
  }
}

export const openAITtsService = new OpenAITtsService();
