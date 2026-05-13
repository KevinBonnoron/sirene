import { getJson, postJson } from '../api';
import { type CliConfig, getConfigPath, loadConfig, saveConfig } from '../config';
import { readLine, sleep, tryOpenBrowser } from '../utils';

interface Options {
  url?: string;
  key?: string;
  /** Comma-separated capability list to request (e.g. "generate,voices:read").
   *  Server validates each entry; omit for full access. */
  scopes?: string;
}

interface CliAuthStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

type CliAuthPoll = { status: 'pending' } | { status: 'expired' } | { status: 'authorized'; secret: string; name: string };

const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_URL_PROMPT = 'http://localhost:5173';

/** `null` means the flag wasn't passed (request full access). An empty
 *  string (`--scopes ""`) is treated the same so a typo doesn't ship a
 *  useless key. A non-empty value parses to the trimmed list. */
function parseScopes(raw: string | undefined): string[] | null {
  if (!raw) {
    return null;
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length === 0 ? null : parts;
}

async function loginViaWeb(config: CliConfig, uiOrigin: string, scopes: string[] | null): Promise<{ secret: string; name: string }> {
  const start = await postJson<CliAuthStart>(config, '/auth/cli/start', { origin: uiOrigin, scopes }, { authRequired: false });
  const verificationUrl = `${start.verificationUri}?code=${encodeURIComponent(start.userCode)}`;

  process.stdout.write('\n');
  process.stdout.write(`First, copy your one-time code: \x1b[1m${start.userCode}\x1b[0m\n`);
  process.stdout.write(`Then open this URL in your browser:\n  ${verificationUrl}\n\n`);
  if (scopes !== null) {
    process.stdout.write(`Requested scopes: ${scopes.join(', ')}\n\n`);
  }
  process.stdout.write('Waiting for authorization');

  tryOpenBrowser(verificationUrl);

  const deadline = Date.now() + Math.min(POLL_TIMEOUT_MS, start.expiresIn * 1000);
  const intervalMs = Math.max(1, start.interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    process.stdout.write('.');
    const result = await postJson<CliAuthPoll>(config, '/auth/cli/poll', { deviceCode: start.deviceCode }, { authRequired: false });
    if (result.status === 'authorized') {
      process.stdout.write(' done!\n\n');
      return { secret: result.secret, name: result.name };
    }
    if (result.status === 'expired') {
      throw new Error('Login session expired. Run `sirene login` again.');
    }
  }
  throw new Error('Login timed out. Run `sirene login` again.');
}

async function promptForUrl(): Promise<string> {
  const answer = (await readLine(`Server URL [${DEFAULT_URL_PROMPT}]: `)).trim();
  return answer || DEFAULT_URL_PROMPT;
}

function assertValidUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid URL`);
  }
}

export async function loginCommand(options: Options): Promise<void> {
  const existing = await loadConfig();
  let url = options.url ?? existing.url;
  if (!url) {
    url = await promptForUrl();
  }
  // Validate every input path: a bad value from --url or the saved config
  // would otherwise reach fetch() and fail with a much less helpful message.
  assertValidUrl(url);

  // Headless / scripted path: `--key <value>` writes the credential straight
  // through with no prompting. The shell can keep it out of history with
  // `read -s K && sirene auth login --key "$K"`, or via `SIRENE_API_KEY`.
  if (options.key) {
    // Probe before persisting so a bad URL or revoked key fails loudly here
    // instead of silently writing junk to disk that breaks the next command.
    const probe: CliConfig = { url, apiKey: options.key };
    await getJson<unknown>(probe, '/me');
    await saveConfig(probe);
    process.stdout.write(`Saved credentials to ${getConfigPath()}\n`);
    return;
  }

  // Default interactive path: open a browser and run the device-code flow.
  // The same URL serves both API and UI: in prod via reverse proxy, in dev
  // via Vite's `/api` proxy back to the backend.
  const scopes = parseScopes(options.scopes);
  const { secret, name } = await loginViaWeb({ url, apiKey: undefined }, url, scopes);

  await saveConfig({ url, apiKey: secret });
  process.stdout.write(`Saved credentials to ${getConfigPath()} (key: ${name})\n`);
}
