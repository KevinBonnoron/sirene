import type { CatalogModel, InferenceServer } from '@sirene/shared';

const GIB = 1024 ** 3;

// Mirrors models.Accepts on the server: the policy, then the device, then the documented VRAM floor.
export function acceptsModel(server: Pick<InferenceServer, 'syncPolicy' | 'lastHealth'>, catalog: Pick<CatalogModel, 'hardware' | 'minVram' | 'backend'>): boolean {
  const backends = server.lastHealth.backends;
  if (backends && backends.length > 0 && !backends.includes(catalog.backend)) {
    return false;
  }
  const hardware = catalog.hardware ?? 'cpu';
  const device = server.lastHealth.device ?? '';
  const vram = server.lastHealth.vram ?? 0;
  if (hardware === 'gpu' && device === 'cpu') {
    return false;
  }
  if (catalog.minVram && vram > 0 && catalog.minVram * GIB > vram) {
    return false;
  }
  switch (server.syncPolicy) {
    case 'cpu':
    case 'gpu':
      return hardware === server.syncPolicy;
    case 'none':
      return false;
    default:
      return true;
  }
}
