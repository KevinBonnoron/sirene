import { BadRequestError } from '../errors';
import { settingRepository } from '../repositories';

const CACHE_TTL_MS = 60_000;

// Settings keys are exclusively API key/token names that we look up internally
// (openai_api_key, elevenlabs_api_key, hf_token, ...). Restricting the format
// shuts down PB filter injection: a key with a quote or && operator could
// otherwise change the predicate when interpolated into the filter string.
const VALID_KEY = /^[a-z][a-z0-9_]*$/;

interface MaskedSetting {
  key: string;
  maskedValue: string;
}

/** In-memory cache of (user, key) -> value with a 60s TTL. Settings are read on
 *  every inference request to fetch API keys, and a network round-trip per call
 *  is wasteful; the cache is invalidated on set/delete for the same key. */
class SettingsService {
  private readonly cache = new Map<string, { value: string; expires: number }>();

  public async get(key: string, userId?: string): Promise<string> {
    if (!userId || !VALID_KEY.test(key)) {
      return '';
    }
    const cacheKey = this.key(userId, key);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    const record = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
    if (record?.value) {
      this.cache.set(cacheKey, { value: record.value, expires: Date.now() + CACHE_TTL_MS });
      return record.value;
    }
    return '';
  }

  public async set(key: string, value: string, userId: string): Promise<void> {
    this.assertValidKey(key);
    // Concurrent set() calls can both miss the existing read and one create() loses
    // the unique-(key,user) race. Treat the conflict as an update on retry; the
    // alternative would be a real PB upsert hook, but that's out of scope.
    try {
      const existing = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
      if (existing) {
        await settingRepository.update(existing.id, { key, value });
      } else {
        await settingRepository.create({ key, value, user: userId });
      }
    } catch (err) {
      if (isUniqueConflict(err)) {
        const existing = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
        if (existing) {
          await settingRepository.update(existing.id, { key, value });
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
    this.cache.set(this.key(userId, key), { value, expires: Date.now() + CACHE_TTL_MS });
  }

  public async delete(key: string, userId: string): Promise<void> {
    this.assertValidKey(key);
    const existing = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
    if (existing) {
      await settingRepository.delete(existing.id);
    }
    this.cache.delete(this.key(userId, key));
  }

  public async listMaskedFor(userId: string): Promise<MaskedSetting[]> {
    const records = await settingRepository.getAllBy(`user = "${userId}"`);
    return records.map((r) => ({ key: r.key, maskedValue: maskValue(r.value) }));
  }

  private assertValidKey(key: string): void {
    if (!VALID_KEY.test(key)) {
      throw new BadRequestError(`Invalid setting key "${key}".`);
    }
  }

  private key(userId: string, key: string): string {
    return `${userId}:${key}`;
  }
}

function isUniqueConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
  return message.includes('unique') || message.includes('already exists');
}

function maskValue(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 4, 12))}`;
}

export const settingsService = new SettingsService();
