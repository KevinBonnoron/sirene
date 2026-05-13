import { BadRequestError, GatewayTimeoutError } from '../errors';
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

    try {
      return await inferenceRepository(target).transcribe(form, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS));
    } catch (err) {
      // AbortSignal.timeout() throws a DOMException with name 'TimeoutError';
      // surface as a typed 504 so the route doesn't need to special-case it.
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new GatewayTimeoutError('transcribe.timeout', 'Transcription timed out');
      }
      throw err;
    }
  }

  private async resolveWhisperModel(): Promise<string> {
    // Catalog order is small -> large; pick the first one that's actually installed.
    const catalog = await modelService.getFullCatalog();
    for (const model of catalog.filter((m) => m.backend === 'whisper')) {
      if (await modelService.isModelInstalled(model)) {
        return model.id;
      }
    }
    throw new BadRequestError('model.whisperNotInstalled', 'No Whisper model installed. Please install one from the Models page.');
  }
}

export const transcribeService = new TranscribeService();
