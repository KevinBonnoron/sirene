import type { GenerateRequest } from '@sirene/shared';
import { useCallback, useRef } from 'react';
import { type GenerateResult, generationClient } from '@/clients/generation.client';
import { stopPlayback } from '@/lib/playback-owner';

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useGenerate() {
  const pending = useRef<AbortController | null>(null);

  async function generate(request: GenerateRequest): Promise<GenerateResult> {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      return await generationClient.generate(request, controller.signal);
    } catch (e) {
      // An abort is a caller that walked away, not a failure to report. Callers already
      // treat a null id as nothing to add to the session.
      if (isAbort(e)) {
        return { generationId: null, delivery: 'file' };
      }
      throw e;
    } finally {
      if (pending.current === controller) {
        pending.current = null;
      }
    }
  }

  // Without the abort, a request still in flight would create its player after the caller
  // unmounted and play a take over whatever came next.
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    stopPlayback();
  }, []);

  return { generate, cancel };
}
