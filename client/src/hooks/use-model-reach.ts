import { useLiveQuery } from '@tanstack/react-db';
import { inferenceServerCollection } from '@/collections';
import { useModels } from './use-models';

/**
 * Whether a model can serve a generation right now: on a server that is enabled and
 * answering, or provided by a cloud API rather than by the fleet at all.
 */
export function useModelReach(): (modelId: string) => boolean {
  const { catalog, installationsByName } = useModels();
  const { data: servers } = useLiveQuery((q) => q.from({ s: inferenceServerCollection }));
  const reachable = new Set((servers ?? []).filter((s) => s.enabled && s.lastHealth.status === 'online').map((s) => s.id));

  return (modelId: string) => {
    const model = catalog.find((m) => m.id === modelId);
    if (model?.types.includes('api')) {
      return true;
    }
    const installation = installationsByName.get(modelId);
    if (installation?.status !== 'installed') {
      return false;
    }
    return installation.serverIds.some((id) => reachable.has(id));
  };
}
