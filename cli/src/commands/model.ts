import type { CatalogModel, Model } from '@sirene/shared';
import { getJson } from '../api';
import { loadConfig } from '../config';
import { color } from '../utils';

export async function modelListCommand(): Promise<void> {
  const config = await loadConfig();

  // Catalog and installed run in parallel: they don't depend on each other
  // and the round-trip dominates total time.
  const [catalog, installed] = await Promise.all([getJson<CatalogModel[]>(config, '/models/catalog'), getJson<Model[]>(config, '/models/installed')]);

  if (catalog.length === 0) {
    process.stdout.write('No model in catalog.\n');
    return;
  }

  const installedById = new Map(installed.map((m) => [m.id, m]));

  const idW = Math.max(2, ...catalog.map((m) => m.id.length));
  const backendW = Math.max(7, ...catalog.map((m) => m.backendDisplayName.length));
  const typesW = Math.max(5, ...catalog.map((m) => m.types.join(',').length));

  process.stdout.write(`${color.bold('ID'.padEnd(idW))}  ${color.bold('BACKEND'.padEnd(backendW))}  ${color.bold('TYPES'.padEnd(typesW))}  STATUS\n`);

  for (const m of catalog) {
    const state = installedById.get(m.id);
    let status: string;
    if (!state) {
      status = color.dim('not installed');
    } else if (state.status === 'pulling') {
      status = color.yellow(`pulling (${state.progress}%)`);
    } else if (state.status === 'installed') {
      const where = state.serverIds.length > 0 ? color.dim(` (${state.serverIds.length} server${state.serverIds.length > 1 ? 's' : ''})`) : '';
      status = `${color.green('installed')}${where}`;
    } else {
      status = color.red(`error: ${state.error ?? 'unknown'}`);
    }
    process.stdout.write(`${m.id.padEnd(idW)}  ${m.backendDisplayName.padEnd(backendW)}  ${m.types.join(',').padEnd(typesW)}  ${status}\n`);
  }
}
