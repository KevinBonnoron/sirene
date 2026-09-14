import type { User } from '@sirene/shared';
import { config } from './config';

export function avatarUrl(user: Pick<User, 'id' | 'avatar'>): string | undefined {
  return user.avatar ? `${config.pb.url}/api/files/users/${user.id}/${user.avatar}` : undefined;
}

export function userInitials(user: Pick<User, 'name' | 'email'>): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const initials = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : source.slice(0, 2);
  return initials.toUpperCase();
}
