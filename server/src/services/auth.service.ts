import PocketBase, { type RecordModel } from 'pocketbase';
import { UnauthorizedError } from '../errors';
import { config } from '../lib/config';
import { pb } from '../lib/pocketbase';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  verified: boolean;
}

interface AuthResult {
  token: string;
  user: AuthUser;
}

interface RegisterParams {
  email: string;
  password: string;
  passwordConfirm: string;
  name?: string;
}

/** Thrown by `register` when the email already exists or PB rejects the payload. */
export class RegistrationFailedError extends Error {
  public readonly code = 'registrationFailed';
}

/** Thrown by `login` for any failure that should map to 401 invalidCredentials. */
export class InvalidCredentialsError extends Error {
  public readonly code = 'invalidCredentials';
}

class AuthService {
  public async login(email: string, password: string): Promise<AuthResult> {
    try {
      const userPb = new PocketBase(config.pb.url);
      const authData = await userPb.collection('users').authWithPassword(email, password);
      return { token: authData.token, user: toAuthUser(authData.record) };
    } catch (err) {
      // Always surface the original cause to the operator log; the route layer
      // only ever gets a `code: 'invalidCredentials'` envelope so the user-facing
      // story stays the same.
      console.warn('[auth/login] authWithPassword failed', err);
      throw new InvalidCredentialsError();
    }
  }

  public async register(params: RegisterParams): Promise<AuthResult> {
    try {
      // Always create as a regular user. Promotion to admin happens in a second step
      // gated by a partial unique index (`idx_users_single_admin`) that allows only
      // one row to hold role = 'admin'. Two concurrent registrations on a fresh
      // install will both try to promote themselves; the DB guarantees only one wins.
      const userPb = new PocketBase(config.pb.url);
      const created = await userPb.collection('users').create({ ...params, role: 'user' });
      try {
        await pb.collection('users').update(created.id, { role: 'admin' });
      } catch (err) {
        // Only the partial-unique-index conflict means "another admin already exists";
        // anything else (PB down, network error) is a real failure and we re-throw
        // rather than returning a clean 201 that hides a system left without an admin.
        if (!isUniqueIndexConflict(err)) {
          console.error('[auth/register] failed to promote first user to admin', err);
          throw err;
        }
      }
      const authData = await userPb.collection('users').authWithPassword(params.email, params.password);
      return { token: authData.token, user: toAuthUser(authData.record) };
    } catch (err) {
      console.warn('[auth/register] PocketBase rejected the registration', err);
      throw new RegistrationFailedError();
    }
  }

  public async refreshFromBearer(authorization: string | undefined): Promise<AuthResult> {
    const token = extractBearer(authorization);
    try {
      const userPb = new PocketBase(config.pb.url);
      userPb.authStore.save(token, null);
      const authData = await userPb.collection('users').authRefresh();
      return { token: authData.token, user: toAuthUser(authData.record) };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  public async meFromBearer(authorization: string | undefined): Promise<AuthUser> {
    const { user } = await this.refreshFromBearer(authorization);
    return user;
  }
}

function extractBearer(authorization: string | undefined): string {
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedError();
  }
  return authorization.slice(7);
}

function toAuthUser(record: RecordModel): AuthUser {
  return {
    id: record.id,
    email: record.email as string,
    name: record.name as string | undefined,
    avatar: record.avatar as string | undefined,
    verified: record.verified as boolean,
  };
}

function isUniqueIndexConflict(err: unknown): boolean {
  // PocketBase surfaces uniqueness violations as ClientResponseError with the SQL
  // index name in the message. Match defensively rather than relying on err.status.
  if (!err || typeof err !== 'object') {
    return false;
  }
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
  if (message.includes('unique') || message.includes('idx_users_single_admin')) {
    return true;
  }
  const data = (err as { response?: { data?: Record<string, { code?: string }> } }).response?.data;
  if (data && typeof data === 'object') {
    return Object.values(data).some((v) => v?.code === 'validation_not_unique');
  }
  return false;
}

export const authService = new AuthService();
