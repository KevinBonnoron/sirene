import { createHash, randomBytes } from 'node:crypto';
import { API_KEY_SCOPES, type ApiKey, type ApiKeyCreated, type ApiKeyScope, type ApiKeySummary } from '@sirene/shared';
import { BadRequestError, NotFoundError } from '../errors';
import { apiKeyRepository } from '../repositories';

const KEY_PREFIX = 'sk_';
const SECRET_BYTES = 24; // 24 bytes -> 32 url-safe base64 chars
const PREFIX_DISPLAY_LENGTH = KEY_PREFIX.length + 8; // "sk_" + 8 chars
// `lastUsedAt` is informational, so we trade exact-second accuracy for a much
// lower write rate: one update per key per 5 minutes is enough for the "last
// used" column in the UI without turning auth into a hot write path.
const LAST_USED_UPDATE_DEBOUNCE_MS = 5 * 60 * 1000;

function generateSecret(): string {
  const random = randomBytes(SECRET_BYTES).toString('base64url');
  return `${KEY_PREFIX}${random}`;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Strict reader used everywhere we materialise a key's scopes.
 *  - `null` (or missing) on the record means full access.
 *  - An array means restricted to exactly those scopes.
 *  - Anything else (non-array, unknown values inside, non-string entries) is
 *    treated as malformed and surfaced as `'malformed'`. The auth path
 *    rejects the key in that case; we never widen permissions on bad data. */
type StrictScopes = ApiKeyScope[] | null | 'malformed';
function readScopesStrict(record: ApiKey): StrictScopes {
  if (record.scopes === null || record.scopes === undefined) {
    return null;
  }
  if (!Array.isArray(record.scopes)) {
    return 'malformed';
  }
  const known = API_KEY_SCOPES as readonly string[];
  for (const scope of record.scopes) {
    if (typeof scope !== 'string' || !known.includes(scope)) {
      return 'malformed';
    }
  }
  return record.scopes as ApiKeyScope[];
}

function toSummary(record: ApiKey): ApiKeySummary {
  const scopes = readScopesStrict(record);
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    // A malformed list shouldn't be silently rendered as "everything"; show
    // the user `[]` (no permissions) so a corrupted row is visibly broken in
    // the UI rather than invisibly over-privileged.
    scopes: scopes === 'malformed' ? [] : scopes,
    lastUsedAt: record.lastUsedAt,
    created: record.created,
  };
}

/** Normalises the incoming `scopes` field on a create request:
 *  - `null` / `undefined` → null (full access)
 *  - `[]` → rejected (caller must say so explicitly via null)
 *  - non-empty array → validated against the known set */
function validateScopesInput(scopes: readonly string[] | null | undefined): ApiKeyScope[] | null {
  if (scopes === null || scopes === undefined) {
    return null;
  }
  if (scopes.length === 0) {
    throw new BadRequestError('apiKey.unknownScope', 'Empty scope list is not allowed: pass null for full access or at least one scope to restrict.');
  }
  const known = new Set<string>(API_KEY_SCOPES);
  for (const scope of scopes) {
    if (!known.has(scope)) {
      throw new BadRequestError('apiKey.unknownScope', `Unknown scope: ${scope}`);
    }
  }
  return scopes as ApiKeyScope[];
}

class ApiKeyService {
  public looksLikeApiKey(token: string): boolean {
    return token.startsWith(KEY_PREFIX);
  }

  public async create(userId: string, name: string, scopes: readonly string[] | null | undefined): Promise<ApiKeyCreated> {
    const validated = validateScopesInput(scopes);
    const secret = generateSecret();
    const record = await apiKeyRepository.create({
      user: userId,
      name,
      prefix: secret.slice(0, PREFIX_DISPLAY_LENGTH),
      hash: hashSecret(secret),
      scopes: validated,
    });
    return { ...toSummary(record), secret };
  }

  public async listForUser(userId: string): Promise<ApiKeySummary[]> {
    const records = await apiKeyRepository.findAllBy('user = {:userId}', { params: { userId } });
    return records.map(toSummary);
  }

  public async revoke(userId: string, id: string): Promise<void> {
    const record = await apiKeyRepository.findOne(id);
    if (!record || record.user !== userId) {
      throw new NotFoundError('apiKey.notFound', 'API key not found');
    }
    await apiKeyRepository.delete(id);
  }

  /** Returns `{ userId, scopes }` for a valid secret, or null if invalid.
   *  `scopes === null` means the key is unrestricted; a non-null array is
   *  the exact capability set. A malformed `scopes` value on the record
   *  invalidates the key. */
  public async resolve(secret: string): Promise<{ userId: string; scopes: ApiKeyScope[] | null } | null> {
    if (!this.looksLikeApiKey(secret)) {
      return null;
    }
    const hash = hashSecret(secret);
    const record = await apiKeyRepository.findBy('hash = {:hash}', { params: { hash } });
    if (!record) {
      return null;
    }
    const scopes = readScopesStrict(record);
    if (scopes === 'malformed') {
      console.warn('[apiKey/resolve] rejecting key with malformed scopes', { id: record.id });
      return null;
    }
    const previous = record.lastUsedAt ? Date.parse(record.lastUsedAt) : 0;
    if (!Number.isFinite(previous) || Date.now() - previous >= LAST_USED_UPDATE_DEBOUNCE_MS) {
      void apiKeyRepository.update(record.id, { lastUsedAt: new Date().toISOString() }).catch((err) => {
        console.warn('[apiKey/resolve] failed to update lastUsedAt', { id: record.id, err });
      });
    }
    return { userId: record.user, scopes };
  }
}

export const apiKeyService = new ApiKeyService();
