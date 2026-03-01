import { settingRepository } from '../repositories';

const cache = new Map<string, { value: string; expires: number }>();
const CACHE_TTL = 60_000; // 1 minute

function cacheKey(userId: string, key: string): string {
  return `${userId}:${key}`;
}

export async function getSetting(key: string, userId?: string): Promise<string> {
  if (userId) {
    const ck = cacheKey(userId, key);
    const cached = cache.get(ck);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    const record = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
    if (record?.value) {
      cache.set(ck, { value: record.value, expires: Date.now() + CACHE_TTL });
      return record.value;
    }
  }

  return '';
}

export async function setSetting(key: string, value: string, userId: string): Promise<void> {
  const existing = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
  if (existing) {
    await settingRepository.update(existing.id, { key, value });
  } else {
    await settingRepository.create({ key, value, user: userId });
  }
  cache.set(cacheKey(userId, key), { value, expires: Date.now() + CACHE_TTL });
}

export async function deleteSetting(key: string, userId: string): Promise<void> {
  const existing = await settingRepository.getOneBy(`key = "${key}" && user = "${userId}"`);
  if (existing) {
    await settingRepository.delete(existing.id);
  }
  cache.delete(cacheKey(userId, key));
}

function maskValue(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 4, 12))}`;
}

export async function getAllSettings(userId: string): Promise<{ key: string; maskedValue: string }[]> {
  const records = await settingRepository.getAllBy(`user = "${userId}"`);
  return records.map((r) => ({
    key: r.key,
    maskedValue: maskValue(r.value),
  }));
}
