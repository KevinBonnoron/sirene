import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliConfig {
  url?: string;
  apiKey?: string;
}

// A trailing /api is stripped for configs written before the URL became the server origin.
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api$/, '');
}

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'sirene', 'config.json');
}

export type ConfigSource = 'file' | 'env' | 'unset';

export interface ResolvedField<T> {
  value: T;
  source: ConfigSource;
}

export interface ResolvedConfig {
  url: ResolvedField<string | undefined>;
  apiKey: ResolvedField<string | undefined>;
}

export async function loadResolvedConfig(): Promise<ResolvedConfig> {
  const fileConfig = await loadFileConfig();

  const envUrl = process.env.SIRENE_URL;
  const envKey = process.env.SIRENE_API_KEY;

  return {
    url: envUrl ? { value: normalizeUrl(envUrl), source: 'env' } : fileConfig.url ? { value: normalizeUrl(fileConfig.url), source: 'file' } : { value: undefined, source: 'unset' },
    apiKey: envKey ? { value: envKey, source: 'env' } : fileConfig.apiKey ? { value: fileConfig.apiKey, source: 'file' } : { value: undefined, source: 'unset' },
  };
}

export async function loadConfig(): Promise<CliConfig> {
  const resolved = await loadResolvedConfig();
  return { url: resolved.url.value, apiKey: resolved.apiKey.value };
}

export async function loadFileConfig(): Promise<Partial<CliConfig>> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw new Error(`Could not read config at ${configPath()}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config at ${configPath()} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Config at ${configPath()} must be a JSON object`);
  }
  const result: Partial<CliConfig> = {};
  const record = parsed as Record<string, unknown>;
  if (typeof record.url === 'string') {
    result.url = record.url;
  } else if (record.url !== undefined) {
    throw new Error(`Config field "url" at ${configPath()} must be a string`);
  }
  if (typeof record.apiKey === 'string') {
    result.apiKey = record.apiKey;
  } else if (record.apiKey !== undefined) {
    throw new Error(`Config field "apiKey" at ${configPath()} must be a string`);
  }
  return result;
}

export async function saveConfig(config: CliConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const cleaned: CliConfig = { ...config };
  if (cleaned.url) {
    cleaned.url = normalizeUrl(cleaned.url);
  }
  await writeFile(path, JSON.stringify(cleaned, null, 2), 'utf8');
  try {
    await chmod(path, 0o600);
  } catch {
    if (process.platform !== 'win32') {
      process.stderr.write(`warning: could not set 0600 permissions on ${path}; the stored API key may be readable by other local users.\n`);
    }
  }
}

export function getConfigPath(): string {
  return configPath();
}
