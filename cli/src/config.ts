import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliConfig {
  url?: string;
  apiKey?: string;
}

/** The config stores the server *origin* (the URL the user opens in their
 *  browser), not the API base. The HTTP client appends `/api/...` itself.
 *  Two reasons:
 *   - users know their UI URL, not implementation paths like `/api`;
 *   - the same value is reused by the device-code flow to open the right page
 *     in the browser.
 *  We strip a trailing `/api` for backward-compat with configs / env vars
 *  written before this change. */
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

/** Resolves each field individually with its provenance. There is no built-in
 *  default for the server URL: the user must supply one (via `auth login --url`,
 *  `config set url`, or the `SIRENE_URL` env var) before any command that
 *  talks to the server will work. */
export async function loadResolvedConfig(): Promise<ResolvedConfig> {
  const fileConfig = await loadFileConfig();

  const envUrl = process.env.SIRENE_URL;
  const envKey = process.env.SIRENE_API_KEY;

  return {
    url: envUrl ? { value: normalizeUrl(envUrl), source: 'env' } : fileConfig.url ? { value: normalizeUrl(fileConfig.url), source: 'file' } : { value: undefined, source: 'unset' },
    apiKey: envKey ? { value: envKey, source: 'env' } : fileConfig.apiKey ? { value: fileConfig.apiKey, source: 'file' } : { value: undefined, source: 'unset' },
  };
}

/** Flat view for code that just needs the effective values. Wraps
 *  `loadResolvedConfig` so we don't duplicate the env / file precedence logic. */
export async function loadConfig(): Promise<CliConfig> {
  const resolved = await loadResolvedConfig();
  return { url: resolved.url.value, apiKey: resolved.apiKey.value };
}

/** File-only view, ignoring env vars. Used by `config set` so updates don't
 *  silently bake `SIRENE_API_KEY` (which only existed in the process env)
 *  into config.json on every write. */
export async function loadFileConfig(): Promise<Partial<CliConfig>> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    // Anything else (permission denied, etc.) is operator-visible so they
    // can fix it rather than running with silently-empty config.
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
  // Narrow each field to a string before returning so downstream code
  // (notably `normalizeUrl`) can rely on the runtime shape and not crash
  // on a hand-edited config that put a number under `url`.
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
  // Normalise on write so the on-disk file is always the server origin,
  // even if the user passed `--url http://host/api` out of habit.
  const cleaned: CliConfig = { ...config };
  if (cleaned.url) {
    cleaned.url = normalizeUrl(cleaned.url);
  }
  await writeFile(path, JSON.stringify(cleaned, null, 2), 'utf8');
  // 0600 so the API key isn't world-readable. Windows has no Unix perms,
  // so a failure there is expected and silent; on Unix-likes we warn the
  // operator so they don't end up with a secret readable by other users.
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
