import type { ApiKeyScope, User } from '@sirene/shared';
import { NotFoundError } from '../errors';
import { pb } from '../lib/pocketbase';

/** Full owner-facing identity. Returned to JWT auth or to API keys that have
 *  unrestricted access (`scopes === null`). */
export interface FullUserProfile {
  id: string;
  email: string;
  name?: string;
  role: 'user' | 'admin';
  scopes: null;
}

/** Minimal identity returned to API keys that carry an explicit scope list.
 *  Restricted keys are typically held by third-party integrations the user
 *  granted limited access to; they have no business reading the account
 *  owner's email, display name, or admin status. */
export interface ScopedKeyIdentity {
  id: string;
  scopes: ApiKeyScope[];
}

export type MeResponse = FullUserProfile | ScopedKeyIdentity;

class UserService {
  /** Resolve `/me` for the authenticated caller. The caller is expected to
   *  have been gated by `authMiddleware`, which means `userId` references a
   *  row PB already verified. A 404 here therefore signals data corruption
   *  (user deleted between middleware and service); any other failure (PB
   *  unreachable, 5xx) propagates as a generic 500 rather than being
   *  mis-mapped to "user not found". */
  public async getMe(userId: string, scopes: ApiKeyScope[] | null): Promise<MeResponse> {
    // A restricted API key (non-null scopes) doesn't need anything beyond
    // the userId + its own scopes to operate; skip the PB roundtrip and
    // don't leak email / name / role to third-party integrations.
    if (scopes !== null) {
      return { id: userId, scopes };
    }

    try {
      const user = await pb.collection<User>('users').getOne(userId);
      return {
        id: user.id,
        email: user.email,
        name: user.name || undefined,
        role: user.role ?? 'user',
        scopes: null,
      };
    } catch (err) {
      const status = (err as { status?: unknown })?.status;
      if (status === 404) {
        throw new NotFoundError('user.notFound', 'User not found');
      }
      throw err;
    }
  }
}

export const userService = new UserService();
