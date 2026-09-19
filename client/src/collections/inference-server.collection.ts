import type { InferenceServer } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const inferenceServerCollection = createCollection(
  pocketbaseCollectionOptions({
    id: 'inference_servers',
    recordService: pb.collection<InferenceServer>('inference_servers'),
    options: { sort: '-priority' },
  }),
);
