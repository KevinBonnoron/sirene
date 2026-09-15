import { stat } from 'node:fs/promises';
import { type ConfigSource, getConfigPath, loadConfig, loadFileConfig, loadResolvedConfig, saveConfig } from '../config';
import { API_KEY_MASK_LENGTH } from '../constants';
import { color } from '../utils';

const SETTABLE = new Set(['url', 'apiKey']);

function sourceTag(source: ConfigSource, envName: string): string {
  if (source === 'file') {
    return color.dim('  (saved)');
  }
  if (source === 'env') {
    return color.dim(`  (env: ${envName})`);
  }
  return '';
}

async function configFileExists(): Promise<boolean> {
  try {
    await stat(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

function formatValue(value: string | undefined): string {
  if (value === undefined) {
    return color.dim('(unset)');
  }
  return value;
}

export async function configGetCommand(key?: string): Promise<void> {
  const resolved = await loadResolvedConfig();
  if (!key) {
    const fileExists = await configFileExists();
    const pathHint = fileExists ? '' : color.dim(' (no file yet)');
    process.stdout.write(`${color.bold('Config:')} ${color.cyan(getConfigPath())}${pathHint}\n\n`);

    const urlTag = resolved.url.value ? sourceTag(resolved.url.source, 'SIRENE_URL') : '';
    process.stdout.write(`  ${color.bold('url:')}    ${formatValue(resolved.url.value)}${urlTag}\n`);

    const apiKeyDisplay = resolved.apiKey.value ? `${resolved.apiKey.value.slice(0, API_KEY_MASK_LENGTH)}...` : undefined;
    const keyTag = resolved.apiKey.value ? sourceTag(resolved.apiKey.source, 'SIRENE_API_KEY') : '';
    process.stdout.write(`  ${color.bold('apiKey:')} ${formatValue(apiKeyDisplay)}${keyTag}\n`);
    return;
  }
  if (!SETTABLE.has(key)) {
    throw new Error(`Unknown config key: ${key} (valid: ${[...SETTABLE].join(', ')})`);
  }
  const config = await loadConfig();
  const value = (config as unknown as Record<string, string | undefined>)[key];
  if (value !== undefined) {
    process.stdout.write(`${value}\n`);
  }
}

export async function configSetCommand(key: string, value: string): Promise<void> {
  if (!SETTABLE.has(key)) {
    throw new Error(`Unknown config key: ${key} (valid: ${[...SETTABLE].join(', ')})`);
  }
  const fileConfig = await loadFileConfig();
  const next = { ...fileConfig, [key]: value };
  await saveConfig(next);
  process.stdout.write(`Saved ${key}\n`);
}
