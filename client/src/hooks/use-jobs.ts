import type { Job } from '@sirene/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { jobsClient } from '@/clients/jobs.client';
import { openAuthenticatedStream } from '@/lib/auth-stream';
import { config } from '@/lib/config';

type Listener = () => void;

class JobsStore {
  private jobs: Job[] = [];
  private readonly listeners = new Set<Listener>();
  private stream: { close: () => void } | null = null;
  private refCount = 0;

  public getSnapshot = (): Job[] => this.jobs;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    this.acquire();
    return () => {
      this.listeners.delete(listener);
      this.release();
    };
  };

  public dismiss(id: string) {
    // Server only allows dismissing terminal jobs (completed/failed). Optimistically
    // hiding a running job would briefly remove an in-flight task from the UI until
    // the next stream event puts it back. Skip the optimism for running jobs and let
    // the server's `remove` broadcast drive the local state.
    const target = this.jobs.find((j) => j.id === id);
    if (target && target.status !== 'running') {
      this.replace(this.jobs.filter((j) => j.id !== id));
    }
    void jobsClient.dismiss(id).catch(() => {
      // If the dismiss failed, the next snapshot/event will re-add the job.
    });
  }

  private acquire() {
    this.refCount++;
    if (this.stream) {
      return;
    }
    // Fetch-based SSE so the auth token travels in an Authorization header
    // (EventSource forces query-param tokens, which leak to logs).
    this.stream = openAuthenticatedStream(`${config.server.url}/jobs/stream`, ({ event, data }) => {
      if (event === 'snapshot') {
        this.replace(JSON.parse(data) as Job[]);
      } else if (event === 'job') {
        const job = JSON.parse(data) as Job;
        const idx = this.jobs.findIndex((j) => j.id === job.id);
        if (idx === -1) {
          this.replace([job, ...this.jobs]);
        } else {
          const next = [...this.jobs];
          next[idx] = job;
          this.replace(next);
        }
      } else if (event === 'remove') {
        const { id } = JSON.parse(data) as { id: string };
        this.replace(this.jobs.filter((j) => j.id !== id));
      }
    });
  }

  private release() {
    this.refCount--;
    if (this.refCount > 0 || !this.stream) {
      return;
    }
    this.stream.close();
    this.stream = null;
    this.jobs = [];
  }

  private replace(next: Job[]) {
    this.jobs = next;
    for (const cb of this.listeners) {
      cb();
    }
  }
}

const store = new JobsStore();

export function useJobs() {
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    jobs,
    dismiss: (id: string) => store.dismiss(id),
  };
}

/** Subscribe to a job's terminal state (completed/failed) and run a side effect once. */
export function useJobCompletion(jobId: string | null, onTerminal: (job: Job) => void) {
  const { jobs } = useJobs();
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      firedFor.current = null;
      return;
    }
    const job = jobs.find((j) => j.id === jobId);
    if (job && job.status !== 'running' && firedFor.current !== job.id) {
      firedFor.current = job.id;
      onTerminal(job);
    }
  }, [jobId, jobs, onTerminal]);
}
