import type { User } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const userCollection = createCollection(
  pocketbaseCollectionOptions({
    id: 'users',
    recordService: pb.collection<User>('users'),
    options: { sort: 'created' },
  }),
);
