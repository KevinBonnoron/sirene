import type { Job } from '@sirene/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { jobsClient } from '@/clients/jobs.client';
import { config } from '@/lib/config';

type Listener = () => void;

class JobsStore {
  private jobs: Job[] = [];
  private readonly listeners = new Set<Listener>();
  private es: EventSource | null = null;
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
    // Optimistic removal — server will also broadcast a remove event.
    this.replace(this.jobs.filter((j) => j.id !== id));
    void jobsClient.dismiss(id).catch(() => {
      // If the dismiss failed, the next snapshot/event will re-add the job.
    });
  }

  private acquire() {
    this.refCount++;
    if (this.es) {
      return;
    }
    this.es = new EventSource(`${config.server.url}/jobs/stream`);

    this.es.addEventListener('snapshot', (event) => {
      this.replace(JSON.parse(event.data) as Job[]);
    });
    this.es.addEventListener('job', (event) => {
      const job = JSON.parse(event.data) as Job;
      const idx = this.jobs.findIndex((j) => j.id === job.id);
      if (idx === -1) {
        this.replace([job, ...this.jobs]);
      } else {
        const next = [...this.jobs];
        next[idx] = job;
        this.replace(next);
      }
    });
    this.es.addEventListener('remove', (event) => {
      const { id } = JSON.parse(event.data) as { id: string };
      this.replace(this.jobs.filter((j) => j.id !== id));
    });
  }

  private release() {
    this.refCount--;
    if (this.refCount > 0 || !this.es) {
      return;
    }
    this.es.close();
    this.es = null;
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
  useEffect(() => {
    if (!jobId) {
      return;
    }
    const job = jobs.find((j) => j.id === jobId);
    if (job && job.status !== 'running') {
      onTerminal(job);
    }
  }, [jobId, jobs, onTerminal]);
}
