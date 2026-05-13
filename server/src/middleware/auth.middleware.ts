import type { ApiKeyScope } from '@sirene/shared';
import type { Context, Next } from 'hono';
import PocketBase from 'pocketbase';
import { config } from '../lib/config';
import { pb } from '../lib/pocketbase';
import { apiKeyService } from '../services/api-key.service';

/** `scopes` is null when the caller has full access (JWT auth or a full
 *  API key), and an array of capabilities when the API key is restricted.
 *  Routes that gate on a specific capability use `requireScope(...)`, which
 *  treats null as a pass.
 *  `authType` distinguishes JWT (browser session) from API key. Routes that
 *  manage credentials themselves (creating/revoking API keys, approving CLI
 *  sessions) use `requireJwtAuth` to block lateral key creation. */
export type AuthEnv = { Variables: { userId: string; isAdmin: boolean; scopes: ApiKeyScope[] | null; authType: 'jwt' | 'api-key' } };

export async function authMiddleware(c: Context, next: Next) {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authorization.slice(7);

  // API keys (CLI / external apps) carry a fixed prefix and resolve directly to a user.
  // We hand off to the JWT path for anything else so the existing browser flow is untouched.
  if (apiKeyService.looksLikeApiKey(token)) {
    try {
      const resolved = await apiKeyService.resolve(token);
      if (!resolved) {
        return c.json({ message: 'Invalid API key' }, 401);
      }
      // A 404 means the user record was deleted (the key references a ghost),
      // so the key is no longer valid. Anything else (PB unreachable, 5xx) is
      // upstream failure and must propagate as 503: swallowing it would mark
      // every key invalid during a transient outage.
      let user: { role?: string };
      try {
        user = await pb.collection('users').getOne(resolved.userId);
      } catch (err) {
        const status = (err as { status?: unknown })?.status;
        if (status === 404) {
          return c.json({ message: 'Invalid API key' }, 401);
        }
        throw err;
      }
      c.set('userId', resolved.userId);
      c.set('isAdmin', user.role === 'admin');
      c.set('scopes', resolved.scopes);
      c.set('authType', 'api-key');
    } catch (err) {
      console.error('[auth] API key resolution failed', err);
      return c.json({ message: 'Authentication service unavailable' }, 503);
    }
    await next();
    return;
  }

  try {
    const userPb = new PocketBase(config.pb.url);
    userPb.authStore.save(token, null);
    const authData = await userPb.collection('users').authRefresh();
    c.set('userId', authData.record.id);
    c.set('isAdmin', authData.record.role === 'admin');
    // JWT auth = account owner via the web UI = full access.
    c.set('scopes', null);
    c.set('authType', 'jwt');
  } catch (err) {
    // PB raises ClientResponseError with a numeric `status`. 401/403 mean the
    // token is genuinely bad; anything else (PB unreachable, 5xx) is upstream
    // failure that we shouldn't paper over as "expired token", because that
    // would log a user out for a transient outage.
    const status = (err as { status?: unknown })?.status;
    if (status === 401 || status === 403) {
      return c.json({ message: 'Invalid or expired token' }, 401);
    }
    console.error('[auth] PocketBase auth refresh failed', err);
    return c.json({ message: 'Authentication service unavailable' }, 503);
  }

  await next();
}

/** Mount after `authMiddleware` on routes that should only be reachable by users
 *  with `role = 'admin'` (the deployment owner - the first registered user). */
export async function requireAdmin(c: Context<AuthEnv>, next: Next) {
  if (!c.get('isAdmin')) {
    return c.json({ message: 'Forbidden' }, 403);
  }

  await next();
}

/** Gate a route on a specific API-key scope. JWT auth and legacy keys
 *  (scopes === null) always pass: scopes only restrict explicitly-scoped
 *  API keys. Returns 403 with `auth.missingScope` so the client can render a
 *  helpful "key lacks permission X" message. */
export function requireScope(scope: ApiKeyScope) {
  return async (c: Context<AuthEnv>, next: Next) => {
    const scopes = c.get('scopes');
    if (scopes === null || scopes.includes(scope)) {
      await next();
      return;
    }
    return c.json({ message: `Missing scope: ${scope}`, code: 'auth.missingScope', missing: scope }, 403);
  };
}

/** Block API-key auth from reaching credential-management endpoints. Even a
 *  full-access key shouldn't be able to mint more keys (lateral escalation)
 *  or approve a CLI device-code session: those operations are the account
 *  owner's prerogative and must be triggered from a real browser login. */
export async function requireJwtAuth(c: Context<AuthEnv>, next: Next) {
  if (c.get('authType') !== 'jwt') {
    return c.json({ message: 'This endpoint requires browser authentication' }, 403);
  }
  await next();
}
