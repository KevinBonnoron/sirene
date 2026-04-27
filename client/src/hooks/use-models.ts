import type { Model } from '@sirene/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { config } from '@/lib/config';
import { useJobs } from './use-jobs';

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
  const { jobs } = useJobs();

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

  // Merge running pull jobs over the installed set so the UI shows live progress.
  // Job targets are encoded as `modelId::serverId`; aggregate per modelId so a model that
  // is pulling on multiple servers shows a single averaged progress.
  const installationsByName = new Map<string, Model>(installedQuery.data.map((i) => [i.id, i]));
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
    installationsByName.set(modelId, { id: modelId, status: 'pulling', progress: avg, serverIds: existing?.serverIds ?? [] });
  }
  for (const [modelId, error] of failedByModel) {
    if (runningByModel.has(modelId) || installationsByName.get(modelId)?.status === 'installed') {
      continue;
    }
    installationsByName.set(modelId, { id: modelId, status: 'error', progress: 0, error, serverIds: [] });
  }

  return {
    catalog: catalogQuery.data,
    installations: installedQuery.data,
    installationsByName,
    isLoading: catalogQuery.isLoading,
  };
}

export function usePullModel() {
  const queryClient = useQueryClient();
  const { jobs } = useJobs();

  // Refresh installed list once each finished job leaves the running state.
  const seenTerminal = useRef(new Set<string>());
  useEffect(() => {
    let didChange = false;
    for (const job of jobs) {
      if (job.type !== 'model_pull') {
        continue;
      }
      if (job.status === 'running') {
        continue;
      }
      if (seenTerminal.current.has(job.id)) {
        continue;
      }
      seenTerminal.current.add(job.id);
      didChange = true;
      if (job.status === 'failed' && job.error) {
        toast.error(job.error);
      }
    }
    if (didChange) {
      queryClient.invalidateQueries({ queryKey: ['models', 'installed'] });
    }
  }, [jobs, queryClient]);

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
