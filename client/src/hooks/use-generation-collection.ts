import { generationsOf } from '@/collections';
import { useAuth } from '@/providers/auth-provider';

export function useGenerationCollection() {
  const { user } = useAuth();
  return generationsOf(user?.id ?? '');
}
