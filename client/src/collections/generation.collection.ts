import type { Generation } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const generationCollection = createCollection<Generation, string>(
  pocketbaseCollectionOptions<Generation>({
    id: 'generations',
    recordService: pb.collection('generations'),
    options: { sort: '-created' },
  }),
);
