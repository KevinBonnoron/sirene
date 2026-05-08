import { BadRequestError } from '../errors';
import { inferenceRepository } from '../repositories';
import { modelService } from './model.service';
import { pickTarget } from './router.service';

const TRANSCRIBE_TIMEOUT_MS = 300_000;

interface TranscribeResult {
  text: string;
  language?: string;
}

class TranscribeService {
  /** Picks the best installed Whisper model and runs transcription on it. The
   *  upstream worker takes a multipart form, so the input is the raw `audio`
   *  File from the route. Throws BadRequestError when no Whisper is installed. */
  public async transcribe(audio: File): Promise<TranscribeResult> {
    const modelPath = await this.resolveWhisperModel();
    const target = await pickTarget({ requireModel: modelPath });

    const form = new FormData();
    form.append('audio', audio);
    form.append('model_path', modelPath);

    return inferenceRepository(target).transcribe(form, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS));
  }

  private async resolveWhisperModel(): Promise<string> {
    // Catalog order is small -> large; pick the first one that's actually installed.
    const catalog = await modelService.getFullCatalog();
    for (const model of catalog.filter((m) => m.backend === 'whisper')) {
      if (await modelService.isModelInstalled(model)) {
        return model.id;
      }
    }
    throw new BadRequestError('No Whisper model installed. Please install one from the Models page.');
  }
}

export const transcribeService = new TranscribeService();
