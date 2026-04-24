import type { CatalogModel, Generation, Voice } from '@sirene/shared';
import type { JSONContent } from '@tiptap/core';
import { pb } from '@/lib/pocketbase';
import type { TakeData } from './take';

function textToJSON(text: string): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text
          ? [
              {
                type: 'text',
                text,
              },
            ]
          : [],
      },
    ],
  };
}

interface MapContext {
  voices: Voice[];
  catalog: CatalogModel[];
}

export function generationToTake(generation: Generation, orderIndex: number, { voices, catalog }: MapContext): TakeData {
  const voice = voices.find((v) => v.id === generation.voice);
  const model = catalog.find((m) => m.id === generation.model);

  const content = generation.ssml_json && typeof generation.ssml_json === 'object' ? (generation.ssml_json as JSONContent) : textToJSON(generation.text);

  return {
    id: generation.id,
    orderIndex,
    state: generation.state ?? 'ready',
    voiceName: voice?.name ?? 'Inconnue',
    voiceAvatarUrl: voice?.avatar ? pb.files.getURL(voice, voice.avatar) : undefined,
    modelName: model?.name ?? generation.model,
    content,
    duration: generation.duration,
    tuning: {
      pitchShift: generation.tuning?.pitchShift ?? 0,
      speedMultiplier: generation.tuning?.speedMultiplier ?? generation.speed ?? 1,
      variationSeed: generation.tuning?.variationSeed ?? 0.5,
    },
  };
}
