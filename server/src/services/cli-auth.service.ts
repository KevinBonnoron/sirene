import { randomBytes } from 'node:crypto';
import { API_KEY_SCOPES, type ApiKeyScope } from '@sirene/shared';
import { BadRequestError, NotFoundError } from '../errors';
import { apiKeyService } from './api-key.service';

const TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_S = 2;
// Excludes 0/O/1/I/L to keep the user-facing code unambiguous when read aloud
// or copied from a noisy terminal. 32 chars divides 256 evenly so picking via
// `byte % length` stays unbiased.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface CliAuthStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type CliAuthPollResult = { status: 'pending' } | { status: 'expired' } | { status: 'authorized'; secret: string; name: string };

export interface CliAuthLookupResult {
  code: string;
  expiresAt: string;
  status: 'pending' | 'authorized' | 'consumed';
  /** Scopes the CLI requested at `/start`. `null` means full access
   *  requested. A non-null array is the exact set the CLI asked for; the
   *  approval page pre-selects these and lets the user untick to narrow
   *  further (but not broaden: the server enforces subset). */
  requestedScopes: ApiKeyScope[] | null;
}

interface Session {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  /** `authorizing` is a transient state set the moment a request enters
   *  `approve()`, before the async key creation runs. It rejects any
   *  concurrent approve for the same code, so two parallel browsers can't
   *  each mint a key. Reverts to `pending` if key creation throws. */
  status: 'pending' | 'authorizing' | 'authorized' | 'consumed';
  requestedScopes: ApiKeyScope[] | null;
  userId?: string;
  apiKeyName?: string;
  secret?: string;
}

function generateUserCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const byte of bytes) {
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

class CliAuthService {
  private readonly byDeviceCode = new Map<string, Session>();
  private readonly byUserCode = new Map<string, string>();

  /** Drops sessions past their TTL. Called lazily so the registry doesn't
   *  grow unbounded if the process is long-running and starts get spammed. */
  private sweep(): void {
    const now = Date.now();
    for (const [code, session] of this.byDeviceCode) {
      if (session.expiresAt < now) {
        this.byDeviceCode.delete(code);
        this.byUserCode.delete(session.userCode);
      }
    }
  }

  private byUserCodeNormalised(input: string): Session | undefined {
    const normalised = input.replace(/\s+/g, '').toUpperCase();
    const deviceCode = this.byUserCode.get(normalised);
    if (!deviceCode) {
      return undefined;
    }
    return this.byDeviceCode.get(deviceCode);
  }

  public start(verificationUri: string, requestedScopes: readonly string[] | null): CliAuthStartResult {
    this.sweep();

    // `null` = full access requested. An array must be non-empty and contain
    // only known scopes; we reject unknown values outright rather than
    // dropping them silently, which would collapse `['xyz']` into a useless
    // empty array.
    let normalisedScopes: ApiKeyScope[] | null;
    if (requestedScopes === null) {
      normalisedScopes = null;
    } else {
      if (requestedScopes.length === 0) {
        throw new BadRequestError('apiKey.unknownScope', 'Requested scope list cannot be empty: pass null for full access.');
      }
      const known = new Set<string>(API_KEY_SCOPES);
      const unknown = requestedScopes.filter((s) => !known.has(s));
      if (unknown.length > 0) {
        throw new BadRequestError('apiKey.unknownScope', `Unknown scope(s): ${unknown.join(', ')}`);
      }
      normalisedScopes = requestedScopes as ApiKeyScope[];
    }

    // Avoid the astronomically-rare userCode collision against an unexpired session.
    let userCode = generateUserCode();
    while (this.byUserCode.has(userCode)) {
      userCode = generateUserCode();
    }
    const deviceCode = randomBytes(32).toString('base64url');

    const session: Session = {
      deviceCode,
      userCode,
      expiresAt: Date.now() + TTL_MS,
      status: 'pending',
      requestedScopes: normalisedScopes,
    };
    this.byDeviceCode.set(deviceCode, session);
    this.byUserCode.set(userCode, deviceCode);

    return {
      deviceCode,
      userCode,
      verificationUri,
      expiresIn: Math.floor(TTL_MS / 1000),
      interval: POLL_INTERVAL_S,
    };
  }

  public lookup(userCode: string): CliAuthLookupResult {
    this.sweep();
    const session = this.byUserCodeNormalised(userCode);
    if (!session) {
      throw new NotFoundError('cliAuth.sessionNotFound', 'CLI session not found or expired');
    }
    // `authorizing` is an internal state that exists only between an approval
    // request entering the service and the API key being created. Surface it
    // as `authorized` to the client: from the UI's perspective the user has
    // already submitted, so another tab opening this code should see the
    // "already used" screen rather than the approval form.
    const externalStatus = session.status === 'authorizing' ? 'authorized' : session.status;
    return {
      code: session.userCode,
      expiresAt: new Date(session.expiresAt).toISOString(),
      status: externalStatus,
      requestedScopes: session.requestedScopes,
    };
  }

  public async approve(userCode: string, userId: string, name: string, scopes: ApiKeyScope[] | null): Promise<void> {
    this.sweep();
    const session = this.byUserCodeNormalised(userCode);
    if (!session) {
      throw new NotFoundError('cliAuth.sessionNotFound', 'CLI session not found or expired');
    }
    if (session.status !== 'pending') {
      throw new BadRequestError('cliAuth.sessionAlreadyUsed', 'CLI session already used');
    }

    // When the CLI asked for a specific scope set, the user can untick to
    // narrow further but cannot grant beyond what was requested. This stops
    // a malicious CLI from displaying "I want voices:read" and silently
    // receiving a full-access key if the approval page is bypassed.
    let grantedScopes: ApiKeyScope[] | null;
    if (session.requestedScopes === null) {
      // CLI didn't restrict, the user can pick anything (or null for full).
      grantedScopes = scopes;
    } else {
      // CLI asked for a specific set. Null from the user is not allowed
      // (would broaden), and any non-subset entry is rejected.
      if (scopes === null) {
        grantedScopes = [...session.requestedScopes];
      } else {
        const requested = new Set<ApiKeyScope>(session.requestedScopes);
        if (!scopes.every((s) => requested.has(s))) {
          throw new BadRequestError('apiKey.unknownScope', 'Granted scopes must be a subset of the requested scopes');
        }
        // An empty granted array would mint a useless key; fall back to the
        // CLI's requested set rather than failing the approval.
        grantedScopes = scopes.length === 0 ? [...session.requestedScopes] : scopes;
      }
    }

    // Reserve the session before the async create so two parallel approvals
    // for the same code don't both pass the pending check and mint separate
    // keys. Roll back on failure so the user can retry from the same page.
    session.status = 'authorizing';
    try {
      const created = await apiKeyService.create(userId, name, grantedScopes);
      session.status = 'authorized';
      session.userId = userId;
      session.apiKeyName = created.name;
      session.secret = created.secret;
    } catch (err) {
      session.status = 'pending';
      throw err;
    }
  }

  public poll(deviceCode: string): CliAuthPollResult {
    this.sweep();
    const session = this.byDeviceCode.get(deviceCode);
    if (!session) {
      return { status: 'expired' };
    }

    if (session.status === 'pending' || session.status === 'authorizing') {
      // Treat the in-flight authorising window as pending so the CLI keeps
      // polling instead of giving up while the server is mid-create.
      return { status: 'pending' };
    }

    if (session.status === 'authorized' && session.secret && session.apiKeyName) {
      // Consume on first successful poll: the secret can never be retrieved a
      // second time. The CLI persists it locally; if the user loses it they
      // start a new flow. We drop the session entry too; a second poll then
      // returns `expired`, which the CLI/UI treat as "session no longer
      // available" (the success was already delivered).
      const out: CliAuthPollResult = { status: 'authorized', secret: session.secret, name: session.apiKeyName };
      session.status = 'consumed';
      session.secret = undefined;
      this.byDeviceCode.delete(deviceCode);
      this.byUserCode.delete(session.userCode);
      return out;
    }

    return { status: 'expired' };
  }
}

export const cliAuthService = new CliAuthService();
