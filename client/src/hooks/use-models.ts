import type { Model } from '@sirene/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { modelClient } from '@/clients/model.client';
import { config } from '@/lib/config';

// Singleton SSE connection shared across all useModels() consumers
let sharedEs: EventSource | null = null;
let refCount = 0;
const changeListeners = new Set<(installations: Model[]) => void>();

function acquireModelEvents(listener: (installations: Model[]) => void) {
  changeListeners.add(listener);
  refCount++;

  if (!sharedEs) {
    sharedEs = new EventSource(`${config.server.url}/models/events`);
    sharedEs.addEventListener('change', (event) => {
      const installations: Model[] = JSON.parse(event.data);
      for (const cb of changeListeners) {
        cb(installations);
      }
    });
  }

  return () => {
    changeListeners.delete(listener);
    refCount--;
    if (refCount === 0 && sharedEs) {
      sharedEs.close();
      sharedEs = null;
    }
  };
}

export function useModels() {
  const queryClient = useQueryClient();

  const catalogQuery = useQuery({
    queryKey: ['models', 'catalog'],
    queryFn: () => modelClient.catalog(),
    initialData: [],
  });

  const installedQuery = useQuery({
    queryKey: ['models', 'installed'],
    queryFn: () => modelClient.installed(),
    initialData: [],
  });

  // Subscribe to filesystem change events via shared SSE
  useEffect(() => {
    return acquireModelEvents((installations) => {
      queryClient.setQueryData(['models', 'installed'], installations);
    });
  }, [queryClient]);

  const installationsByName = new Map(installedQuery.data.map((i) => [i.id, i]) ?? []);

  return {
    catalog: catalogQuery.data,
    installations: installedQuery.data,
    installationsByName,
    isLoading: catalogQuery.isLoading,
  };
}

export function usePullModel() {
  const queryClient = useQueryClient();
  const [pulling, setPulling] = useState<Map<string, number>>(new Map());

  const pullModel = useCallback(
    (modelId: string) => {
      const es = new EventSource(`${config.server.url}/models/${modelId}/pull`);

      setPulling((prev) => new Map(prev).set(modelId, 0));

      es.addEventListener('progress', (event) => {
        const { progress } = JSON.parse(event.data);
        setPulling((prev) => new Map(prev).set(modelId, progress));
      });

      es.addEventListener('complete', () => {
        es.close();
        setPulling((prev) => {
          const next = new Map(prev);
          next.delete(modelId);
          return next;
        });
        queryClient.invalidateQueries({ queryKey: ['models', 'installed'] });
      });

      es.addEventListener('error', () => {
        es.close();
        setPulling((prev) => {
          const next = new Map(prev);
          next.delete(modelId);
          return next;
        });
        queryClient.invalidateQueries({ queryKey: ['models', 'installed'] });
      });
    },
    [queryClient],
  );

  return { pullModel, pulling };
}
