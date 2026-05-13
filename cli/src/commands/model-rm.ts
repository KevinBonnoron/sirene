import { ApiError } from '../api';
import { type CliConfig, loadConfig } from '../config';
import { color, readLine } from '../utils';

interface Options {
  serverId?: string;
  force?: boolean;
}

async function confirm(prompt: string): Promise<boolean> {
  const answer = (await readLine(`${prompt} [y/N]: `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

async function deleteModel(config: CliConfig, modelId: string, serverId?: string): Promise<void> {
  if (!config.url || !config.apiKey) {
    throw new ApiError(0, 'Not logged in. Run `sirene auth login` first.');
  }
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
  const url = `${config.url.replace(/\/+$/, '')}/api/models/${encodeURIComponent(modelId)}${query}`;
  // Match the shared request helper: bound the call so an unreachable worker
  // doesn't hang the CLI indefinitely waiting for a DELETE that won't return.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, `Request timed out after 30s: ${url}`);
    }
    throw new ApiError(0, `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string' ? (body as { message: string }).message : `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
}

export async function modelRmCommand(modelId: string, options: Options): Promise<void> {
  const config = await loadConfig();

  // Confirmation guard: deletes are destructive and there's no undo (the
  // model files are removed from the worker's disk). --force bypasses for
  // scripts, but the default flow refuses without an explicit yes.
  if (!options.force) {
    const scope = options.serverId ? `from server "${options.serverId}"` : 'from every server it is installed on';
    if (!process.stdin.isTTY) {
      throw new Error(`Refusing to remove "${modelId}" non-interactively. Re-run with --force.`);
    }
    process.stdout.write(`${color.yellow('!')} This will remove ${color.bold(modelId)} ${scope}.\n`);
    if (!(await confirm('Continue?'))) {
      process.stdout.write('Cancelled.\n');
      return;
    }
  }

  await deleteModel(config, modelId, options.serverId);
  process.stdout.write(`${color.green('✓')} Removed ${color.bold(modelId)}${options.serverId ? ` from ${options.serverId}` : ''}.\n`);
}
