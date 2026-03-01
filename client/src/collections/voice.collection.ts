import type { Voice } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const voiceCollection = createCollection<Voice, string>(
  pocketbaseCollectionOptions<Voice>({
    id: 'voices',
    recordService: pb.collection('voices'),
    options: { sort: '-created' },
  }),
);
