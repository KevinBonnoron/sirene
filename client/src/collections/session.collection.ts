import type { Session } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const sessionCollection = createCollection<Session, string>(
  pocketbaseCollectionOptions<Session>({
    id: 'sessions',
    recordService: pb.collection('sessions'),
    options: { sort: '-updated' },
  }),
);
