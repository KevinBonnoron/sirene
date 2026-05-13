import type { CliConfig } from './config';

export class ApiError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  json?: unknown;
  authRequired?: boolean;
}

/** Default request deadline. Long enough for the slowest realistic CLI call
 *  (e.g. fetching a generation), short enough that an unreachable / stuck
 *  server doesn't hang the user's terminal indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;

async function request(config: CliConfig, path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', json, authRequired = true } = options;
  if (!config.url) {
    throw new ApiError(0, 'No server URL configured. Run `sirene auth login --url <url>` or set $SIRENE_URL.');
  }
  const headers: Record<string, string> = {};
  if (authRequired) {
    if (!config.apiKey) {
      throw new ApiError(0, 'Not logged in. Run `sirene auth login` or set $SIRENE_API_KEY.');
    }
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // config.url is the server origin (no `/api` suffix); the CLI owns the path
  // prefix so the user only ever deals with the URL they open in their browser.
  const url = `${config.url.replace(/\/+$/, '')}/api${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw new ApiError(0, `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string' ? (body as { message: string }).message : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function getJson<T>(config: CliConfig, path: string, options: Omit<RequestOptions, 'method' | 'json'> = {}): Promise<T> {
  const res = await request(config, path, options);
  return res.json() as Promise<T>;
}

export async function postJson<T>(config: CliConfig, path: string, body: unknown, options: Omit<RequestOptions, 'method' | 'json'> = {}): Promise<T> {
  const res = await request(config, path, { ...options, method: 'POST', json: body });
  return res.json() as Promise<T>;
}

export async function postForBytes(config: CliConfig, path: string, body: unknown): Promise<{ bytes: Uint8Array; contentType: string; sampleRate?: number; channels?: number; bitsPerSample?: number }> {
  const res = await request(config, path, { method: 'POST', json: body });
  const buffer = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    sampleRate: parseHeaderInt(res.headers.get('x-sample-rate')),
    channels: parseHeaderInt(res.headers.get('x-channels')),
    bitsPerSample: parseHeaderInt(res.headers.get('x-bits-per-sample')),
  };
}

function parseHeaderInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const n = Number(value);
  // Sample rate / channel count / bit depth are positive integers by
  // definition. A 0 or fractional value from a buggy server should fail
  // closed rather than silently producing garbage WAV headers downstream.
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
