import { getConfigPath, loadFileConfig, saveConfig } from '../config';

export async function logoutCommand(): Promise<void> {
  const fileConfig = await loadFileConfig();
  await saveConfig({ url: fileConfig.url, apiKey: undefined });
  process.stdout.write(`Cleared credentials from ${getConfigPath()}\n`);
  if (process.env.SIRENE_API_KEY) {
    process.stdout.write('Note: SIRENE_API_KEY is still set in this shell; commands will keep using it. Run `unset SIRENE_API_KEY` to log out fully.\n');
  }
}
