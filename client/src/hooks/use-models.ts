import type { Model } from '@sirene/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { modelClient } from '@/clients/model.client';
import { config } from '@/lib/config';
import { useJobs } from './use-jobs';

// Singleton SSE connection shared across all useModels() consumers. The endpoint
// only emits opaque change pings (auth-free); listeners refetch the protected
// /installed endpoint, which is where the authorization boundary actually lives.
let sharedEs: EventSource | null = null;
let refCount = 0;
const changeListeners = new Set<() => void>();

function acquireModelEvents(listener: () => void) {
  changeListeners.add(listener);
  refCount++;

  if (!sharedEs) {
    sharedEs = new EventSource(`${config.server.url}/models/events`);
    sharedEs.addEventListener('change', () => {
      for (const cb of changeListeners) {
        cb();
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

  // Subscribe to filesystem change events via shared SSE. The event is just a "go
  // refetch" trigger — the actual data still goes through the auth-protected
  // /installed endpoint via React Query.
  useEffect(() => {
    return acquireModelEvents(() => {
      queryClient.invalidateQueries({ queryKey: ['models', 'installed'] });
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

  // Refresh the installed list when a pull job actually transitions running → terminal.
  // We compare against the previous status instead of "have I seen this id before" so
  // jobs that are already terminal on first render (page refresh, HMR) don't replay
  // their toasts and don't trigger redundant invalidations.
  const previousStatusById = useRef(new Map<string, string>());
  useEffect(() => {
    let didChange = false;
    const next = new Map<string, string>();
    for (const job of jobs) {
      if (job.type !== 'model_pull') {
        continue;
      }
      next.set(job.id, job.status);
      const previousStatus = previousStatusById.current.get(job.id);
      if (previousStatus === 'running' && job.status !== 'running') {
        didChange = true;
        if (job.status === 'failed' && job.error) {
          toast.error(job.error);
        }
      }
    }
    previousStatusById.current = next;
    if (didChange) {
      queryClient.invalidateQueries({ queryKey: ['models', 'installed'] });
    }
  }, [jobs, queryClient]);

  const pullModel = useCallback(
    async (modelId: string, serverIds?: string[]) => {
      try {
        await modelClient.pull(modelId, serverIds);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start download';
        toast.error(message);
      }
    },
    // modelClient is a stable module-level singleton, but listing it documents the
    // intent and satisfies the React hooks lint rule.
    [],
  );

  return { pullModel };
}
