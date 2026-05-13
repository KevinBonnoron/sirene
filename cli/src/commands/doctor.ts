import type { InferenceServer, Model } from '@sirene/shared';
import { ApiError, getJson } from '../api';
import { type CliConfig, loadConfig } from '../config';
import { color } from '../utils';

interface Me {
  id: string;
  email: string;
  role: string;
}

interface Setting {
  key: string;
}

type CheckResult = { ok: true; detail: string } | { ok: false; detail: string };

async function runChecks(config: CliConfig): Promise<{ label: string; result: CheckResult }[]> {
  const checks: { label: string; result: CheckResult }[] = [];

  // Config
  if (!config.url) {
    checks.push({ label: 'Server URL configured', result: { ok: false, detail: 'no URL - run `sirene auth login --url <url>`' } });
    return checks;
  }
  checks.push({ label: 'Server URL configured', result: { ok: true, detail: config.url } });

  if (!config.apiKey) {
    checks.push({ label: 'API key configured', result: { ok: false, detail: 'no key - run `sirene auth login`' } });
    return checks;
  }
  // Don't echo any part of the secret in diagnostics output: even the
  // prefix is recorded server-side as a way to identify the key, so
  // surfacing it in a doctor log makes correlation easier for anyone with
  // read access to that output.
  checks.push({ label: 'API key configured', result: { ok: true, detail: 'configured' } });

  // Server reachable (health is public, no auth)
  try {
    await getJson<{ status: string }>(config, '/health', { authRequired: false });
    checks.push({ label: 'Server reachable', result: { ok: true, detail: 'GET /health → 200' } });
  } catch (err) {
    checks.push({ label: 'Server reachable', result: { ok: false, detail: err instanceof ApiError ? err.message : 'unreachable' } });
    return checks; // Pointless to keep probing if the server is down.
  }

  // Authenticated
  let me: Me | null = null;
  try {
    me = await getJson<Me>(config, '/me');
    checks.push({ label: 'API key valid', result: { ok: true, detail: `${me.email}${me.role === 'admin' ? ' (admin)' : ''}` } });
  } catch (err) {
    checks.push({ label: 'API key valid', result: { ok: false, detail: err instanceof ApiError ? err.message : 'auth failed' } });
    return checks;
  }

  // Inference workers
  try {
    const servers = await getJson<InferenceServer[]>(config, '/inference-servers');
    const online = servers.filter((s) => s.lastHealth?.status === 'online');
    const offline = servers.filter((s) => s.lastHealth?.status === 'offline');
    if (servers.length === 0) {
      checks.push({ label: 'Inference workers', result: { ok: false, detail: 'no worker registered - add one in Settings' } });
    } else if (online.length === 0) {
      checks.push({ label: 'Inference workers', result: { ok: false, detail: `${servers.length} registered, none online (${offline.length} offline)` } });
    } else {
      checks.push({ label: 'Inference workers', result: { ok: true, detail: `${online.length}/${servers.length} online` } });
    }
  } catch (err) {
    checks.push({ label: 'Inference workers', result: { ok: false, detail: err instanceof ApiError ? err.message : 'check failed' } });
  }

  // Installed models
  try {
    const models = await getJson<Model[]>(config, '/models/installed');
    const installed = models.filter((m) => m.status === 'installed');
    if (installed.length === 0) {
      checks.push({ label: 'Installed models', result: { ok: false, detail: 'none - install one via `sirene model pull <id>` or the web UI' } });
    } else {
      checks.push({ label: 'Installed models', result: { ok: true, detail: `${installed.length} model${installed.length > 1 ? 's' : ''}` } });
    }
  } catch (err) {
    checks.push({ label: 'Installed models', result: { ok: false, detail: err instanceof ApiError ? err.message : 'check failed' } });
  }

  // Third-party API keys (informational; only warn, don't fail)
  try {
    const settings = await getJson<Setting[]>(config, '/settings');
    const keyNames = new Set(settings.map((s) => s.key));
    const configured = ['openai_api_key', 'elevenlabs_api_key', 'hf_token'].filter((k) => keyNames.has(k));
    if (configured.length === 0) {
      checks.push({ label: 'Third-party API keys', result: { ok: true, detail: 'none configured (OK if you only use local backends)' } });
    } else {
      checks.push({ label: 'Third-party API keys', result: { ok: true, detail: configured.join(', ') } });
    }
  } catch {
    // Best-effort: settings access may be restricted; don't fail the whole doctor.
    checks.push({ label: 'Third-party API keys', result: { ok: true, detail: '(unable to read; skipping)' } });
  }

  return checks;
}

export async function doctorCommand(): Promise<void> {
  const config = await loadConfig();
  const checks = await runChecks(config);

  for (const { label, result } of checks) {
    const mark = result.ok ? color.green('✓') : color.red('✗');
    process.stdout.write(`${mark} ${label.padEnd(28)}${color.dim(result.detail)}\n`);
  }

  const failed = checks.filter((c) => !c.result.ok).length;
  process.stdout.write('\n');
  if (failed === 0) {
    process.stdout.write(`${color.green('All checks passed.')}\n`);
    process.exit(0);
  }
  process.stdout.write(`${color.red(`${failed} check${failed > 1 ? 's' : ''} failed.`)}\n`);
  process.exit(1);
}
