import type { Generation, GenerationAlignment, WordAlignment } from '@sirene/shared';
import { generationRepository } from '../repositories';
import { NotFoundError } from './service-error';

export interface ListGenerationsFilter {
  voice?: string;
  model?: string;
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
