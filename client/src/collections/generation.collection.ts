import type { Generation } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

const byUser = new Map<string, ReturnType<typeof build>>();

function build(userId: string) {
  return createCollection<Generation, string>(
    pocketbaseCollectionOptions<Generation>({
      id: `generations:${userId}`,
      recordService: pb.collection('generations'),
      options: { sort: '-created', filter: pb.filter('user = {:userId}', { userId }) },
    }),
  );
}

// Admins may read every generation; personal views only ever sync the caller's own.
export function generationsOf(userId: string) {
  let collection = byUser.get(userId);
  if (!collection) {
    collection = build(userId);
    byUser.set(userId, collection);
  }
  return collection;
}
