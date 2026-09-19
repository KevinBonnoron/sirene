import type { User } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const userCollection = createCollection<User, string>(
  pocketbaseCollectionOptions<User>({
    id: 'users',
    recordService: pb.collection('users'),
    options: { sort: 'created' },
  }),
);
