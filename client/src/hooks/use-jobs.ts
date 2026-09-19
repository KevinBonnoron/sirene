import type { Job } from '@sirene/shared';
import { useSyncExternalStore } from 'react';
import { jobsClient } from '@/clients/jobs.client';
import { subscribeToAppEvents } from '@/lib/app-events';

type Listener = () => void;

class JobsStore {
  private jobs: Job[] = [];
  private readonly listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;
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
    // The server refuses to dismiss running jobs, so no optimistic removal for those.
    const target = this.jobs.find((j) => j.id === id);
    if (target && target.status !== 'running') {
      this.replace(this.jobs.filter((j) => j.id !== id));
    }
    void jobsClient.dismiss(id).catch(() => {});
  }

  private acquire() {
    this.refCount++;
    if (this.unsubscribe) {
      return;
    }
    this.unsubscribe = subscribeToAppEvents(({ event, data }) => {
      if (event === 'jobs') {
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
      } else if (event === 'job.removed') {
        const { id } = JSON.parse(data) as { id: string };
        this.replace(this.jobs.filter((j) => j.id !== id));
      }
    });
  }

  private release() {
    this.refCount--;
    if (this.refCount > 0 || !this.unsubscribe) {
      return;
    }
    this.unsubscribe();
    this.unsubscribe = null;
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
