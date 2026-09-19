import type { Invite } from '@sirene/shared';
import { createCollection } from '@tanstack/db';
import { pocketbaseCollectionOptions } from 'pocketbase-db-collection';
import { pb } from '@/lib/pocketbase';

export const invitationCollection = createCollection<Invite, string>(
  pocketbaseCollectionOptions<Invite>({
    id: 'invitations',
    recordService: pb.collection('invitations'),
    options: { sort: '-created' },
  }),
);
