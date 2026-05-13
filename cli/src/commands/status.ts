import { ApiError, getJson } from '../api';
import { loadConfig } from '../config';
import { API_KEY_MASK_LENGTH } from '../constants';

interface Me {
  id: string;
  email: string;
  name?: string;
  role: string;
}

function maskKey(key: string): string {
  return `${key.slice(0, API_KEY_MASK_LENGTH)}...`;
}

export async function authStatusCommand(): Promise<void> {
  const config = await loadConfig();

  if (!config.url) {
    process.stdout.write('Not configured.\n  Run `sirene auth login --url <url>` to get started.\n');
    return;
  }

  if (!config.apiKey) {
    process.stdout.write(`Not logged in.\n  Server: ${config.url}\n  Run \`sirene auth login\` to authenticate.\n`);
    return;
  }

  try {
    const me = await getJson<Me>(config, '/me');
    process.stdout.write(`✓ Logged in to ${config.url}\n`);
    process.stdout.write(`  User: ${me.email}${me.name ? ` (${me.name})` : ''}\n`);
    if (me.role === 'admin') {
      process.stdout.write('  Role: admin\n');
    }
    process.stdout.write(`  Key:  ${maskKey(config.apiKey)}\n`);
  } catch (err) {
    // Authenticated context is broken (revoked / wrong server / etc). Surface
    // the cause but exit non-zero so scripts can branch on it.
    process.stdout.write(`✗ Not authenticated to ${config.url}\n`);
    process.stdout.write(`  Key:  ${maskKey(config.apiKey)}\n`);
    if (err instanceof ApiError) {
      process.stdout.write(`  Reason: ${err.message}\n`);
    }
    process.stdout.write('  Run `sirene auth login` to refresh.\n');
    process.exit(1);
  }
}
