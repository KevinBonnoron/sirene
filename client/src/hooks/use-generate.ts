import type { GenerateRequest } from '@sirene/shared';
import { useState } from 'react';
import { generationClient } from '@/clients/generation.client';

export function useGenerate() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastAudioBlob, setLastAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(request: GenerateRequest) {
    setIsGenerating(true);
    setError(null);
    try {
      const blob = await generationClient.generate(request);
      setLastAudioBlob(blob);
      return blob;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed';
      setError(msg);
      throw e;
    } finally {
      setIsGenerating(false);
    }
  }

  return { generate, isGenerating, lastAudioBlob, error };
}
