import { getConfigPath, loadFileConfig, saveConfig } from '../config';

export async function logoutCommand(): Promise<void> {
  // Use the file-only view so an env-resolved value (e.g. `SIRENE_URL` set
  // for this shell) doesn't get persisted into config.json on logout.
  const fileConfig = await loadFileConfig();
  await saveConfig({ url: fileConfig.url, apiKey: undefined });
  process.stdout.write(`Cleared credentials from ${getConfigPath()}\n`);
  // `SIRENE_API_KEY` overrides the file at load time, so a logout that only
  // clears the file leaves the env-sourced key in effect for the current
  // shell. Surface that so the user isn't surprised by the next command
  // still being "logged in".
  if (process.env.SIRENE_API_KEY) {
    process.stdout.write('Note: SIRENE_API_KEY is still set in this shell; commands will keep using it. Run `unset SIRENE_API_KEY` to log out fully.\n');
  }
}
