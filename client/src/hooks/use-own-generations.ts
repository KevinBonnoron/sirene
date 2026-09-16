import { useLiveQuery } from '@tanstack/react-db';
import { useGenerationCollection } from './use-generation-collection';

export function useOwnGenerations() {
  const generations = useGenerationCollection();
  return useLiveQuery((q) => q.from({ g: generations }).orderBy(({ g }) => g.created, 'desc'), [generations]);
}
