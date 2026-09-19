import type { VoiceSample } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const voiceSampleCollection = createCollection(
  pocketbaseCollectionOptions({
    id: 'voice_samples',
    recordService: pb.collection<VoiceSample>('voice_samples'),
    options: { sort: 'order,created' },
  }),
);
