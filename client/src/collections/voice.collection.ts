import type { Voice } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const voiceCollection = createCollection(
  pocketbaseCollectionOptions({
    id: 'voices',
    recordService: pb.collection<Voice>('voices'),
    options: { sort: '-created' },
  }),
);
