import type { CatalogModel, Model } from '@sirene/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { subscribeToAppEvents } from '@/lib/app-events';
import { useJobs } from './use-jobs';

const EMPTY_CATALOG: CatalogModel[] = [];
const EMPTY_INSTALLED: Model[] = [];

const INSTALLED_KEY = ['models', 'installed'] as const;
const CATALOG_KEY = ['models', 'catalog'] as const;

export function useModels() {
  const queryClient = useQueryClient();
  const { jobs } = useJobs();

  const catalogQuery = useQuery({
    queryKey: CATALOG_KEY,
    queryFn: () => modelClient.catalog(),
    staleTime: 5 * 60 * 1000,
  });

  const installedQuery = useQuery({
    queryKey: INSTALLED_KEY,
    queryFn: () => modelClient.installed(),
    placeholderData: EMPTY_INSTALLED,
    staleTime: 10 * 1000,
  });

  useEffect(
    () =>
      subscribeToAppEvents(({ event }) => {
        // A dropped stream leaves an unknown amount of missed changes behind it.
        if (event === 'models' || event === 'dropped') {
          queryClient.invalidateQueries({ queryKey: INSTALLED_KEY });
        }
      }),
    [queryClient],
  );

  const installed = installedQuery.data ?? EMPTY_INSTALLED;
  const installationsByName = new Map<string, Model>(installed.map((i) => [i.id, i]));
  const runningByModel = new Map<string, number[]>();
  const failedByModel = new Map<string, string>();
  for (const job of jobs) {
    if (job.type !== 'model_pull' || !job.target) {
      continue;
    }
    const modelId = job.target.split('::')[0];
    if (!modelId) {
      continue;
    }
    if (job.status === 'running') {
      const arr = runningByModel.get(modelId) ?? [];
      arr.push(job.progress);
      runningByModel.set(modelId, arr);
    } else if (job.status === 'failed' && job.error) {
      failedByModel.set(modelId, job.error);
    }
  }
  for (const [modelId, progresses] of runningByModel) {
    const avg = Math.floor(progresses.reduce((acc, p) => acc + p, 0) / progresses.length);
    const existing = installationsByName.get(modelId);
    installationsByName.set(modelId, { id: modelId, status: 'pulling', progress: avg, serverIds: existing?.serverIds ?? [], wanted: existing?.wanted ?? true });
  }
  for (const [modelId, error] of failedByModel) {
    if (runningByModel.has(modelId) || installationsByName.get(modelId)?.status === 'installed') {
      continue;
    }
    installationsByName.set(modelId, { id: modelId, status: 'error', progress: 0, error, serverIds: [], wanted: installationsByName.get(modelId)?.wanted ?? true });
  }

  return {
    catalog: catalogQuery.data ?? EMPTY_CATALOG,
    installations: installed,
    installationsByName,
    isLoading: catalogQuery.isLoading,
  };
}

export function usePullModel() {
  const { jobs } = useJobs();

  const previousStatusById = useRef(new Map<string, string>());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const job of jobs) {
      if (job.type !== 'model_pull') {
        continue;
      }
      next.set(job.id, job.status);
      if (previousStatusById.current.get(job.id) === 'running' && job.status === 'failed' && job.error) {
        toast.error(job.error);
      }
    }
    previousStatusById.current = next;
  }, [jobs]);

  const pullModel = useCallback(async (modelId: string, serverIds?: string[]) => {
    try {
      await modelClient.pull(modelId, serverIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start download';
      toast.error(message);
    }
  }, []);

  return { pullModel };
}
