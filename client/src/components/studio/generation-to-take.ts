import type { Generation } from '@sirene/shared';
import type { JSONContent } from '@tiptap/core';
import { pb } from '@/lib/pocketbase';
import type { TakeData } from './take';

function textToJSON(text: string): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  };
}

export function generationToTake(generation: Generation, orderIndex: number): TakeData {
  // TipTap docs are objects shaped `{ type: 'doc', content: [...] }`. PB stores
  // editorContent as freeform JSON, so a generation could carry an array, a
  // string, or a malformed object - any of which would fail at render time. Fall
  // back to the plain-text reconstruction unless we can confirm the doc shape.
  const candidate = generation.editorContent;
  const isValidDoc = typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) && (candidate as Record<string, unknown>).type === 'doc';
  const content = isValidDoc ? (candidate as JSONContent) : textToJSON(generation.text);

  return {
    id: generation.id,
    orderIndex,
    state: generation.state ?? 'ready',
    voiceId: generation.voice,
    content,
    duration: generation.duration,
    audioUrl: generation.audio ? pb.files.getURL(generation, generation.audio) : undefined,
    tuning: {
      pitchShift: generation.tuning?.pitchShift ?? 0,
      speedMultiplier: generation.tuning?.speedMultiplier ?? generation.speed ?? 1,
      variationSeed: generation.tuning?.variationSeed ?? 0.5,
      prosodyCurve: generation.tuning?.prosodyCurve,
      wordRates: generation.tuning?.wordRates,
    },
  };
}
