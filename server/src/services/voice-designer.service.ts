import type { Voice } from '@sirene/shared';
import { BadRequestError, NotFoundError } from '../errors';
import { inferenceRepository, voiceRepository, voiceSampleRepository } from '../repositories';
import { modelService } from './model.service';
import { pickTarget } from './router.service';

interface PreviewParams {
  modelId: string;
  text: string;
  instructText: string;
  gender: 'male' | 'female';
  language: string;
}

interface SaveDesignedVoiceParams {
  userId: string;
  name: string;
  description?: string;
  language?: string;
  model?: string;
  transcript?: string;
  audio: File;
}

class VoiceDesignerService {
  /** Generates a one-off audio sample for a model + instruct prompt without
   *  persisting anything. Throws NotFoundError / BadRequestError for unknown
   *  or uninstalled models so the route layer maps them via mapServiceError. */
  public async preview({ modelId, text, instructText, gender, language }: PreviewParams): Promise<Buffer> {
    const catalog = await modelService.getFullCatalog().then((c) => c.find((m) => m.id === modelId));
    if (!catalog) {
      throw new NotFoundError(`Model "${modelId}" not found`);
    }
    if (!(await modelService.isModelInstalled(catalog))) {
      throw new BadRequestError(`Model "${catalog.name}" is not installed`);
    }

    const target = await pickTarget({ requireModel: catalog.id });
    return inferenceRepository(target).generate({
      backend: catalog.backend,
      text,
      modelPath: catalog.id,
      instructText,
      instructGender: gender,
      language,
    });
  }

  /** Persist a designed voice + its single seed sample. The sample upload races
   *  the voice insert, so any failure on the sample side leaves an orphan voice
   *  -- documented for now, addressed when we add transactional voice creation. */
  public async save({ userId, name, description, language, model, transcript, audio }: SaveDesignedVoiceParams): Promise<Voice> {
    const voice = (await voiceRepository.create({
      name,
      description: description ?? '',
      language: language ?? 'en',
      model: model ?? '',
      options: {},
      user: userId,
      public: false,
      tags: [],
    })) as Voice;

    const sampleForm = new FormData();
    sampleForm.append('voice', voice.id);
    sampleForm.append('audio', audio);
    sampleForm.append('transcript', transcript ?? '');
    sampleForm.append('duration', '0');
    sampleForm.append('order', '0');
    sampleForm.append('enabled', 'true');
    await voiceSampleRepository.create(sampleForm);

    return voice;
  }
}

export const voiceDesignerService = new VoiceDesignerService();
