import type { Job, JobType } from '@sirene/shared';

type JobUpdate = { type: 'job'; job: Job } | { type: 'remove'; id: string };
type Listener = (update: JobUpdate) => void;

const COMPLETED_TTL_MS = 30_000;
// Coalesce progress emissions inside this window. Fast-downloading models (Kokoro, Piper)
// can fire 50-100 percent updates per second per job; flushing to listeners on every one
// of those would saturate React. Terminal events (start/complete/fail/remove) bypass this.
const PROGRESS_THROTTLE_MS = 100;

class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly listeners = new Set<Listener>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Pending progress updates keyed by job id — only the latest per job is kept. */
  private readonly pendingProgress = new Map<string, Job>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  public list(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  /** Find a running job by type+target — used to dedupe (e.g. avoid double model pulls). */
  public findRunning(type: JobType, target: string): Job | null {
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && job.type === type && job.target === target) {
        return job;
      }
    }
    return null;
  }

  public start(input: { id: string; type: JobType; label: string; target?: string }): Job {
    const job: Job = {
      id: input.id,
      type: input.type,
      status: 'running',
      progress: 0,
      label: input.label,
      target: input.target,
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.emit({ type: 'job', job });
    return job;
  }

  public progress(id: string, progress: number, label?: string) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') {
      return;
    }
    const next: Job = { ...job, progress: Math.max(0, Math.min(100, Math.round(progress))) };
    if (label) {
      next.label = label;
    }
    if (next.progress === job.progress && next.label === job.label) {
      return;
    }
    this.jobs.set(id, next);
    this.pendingProgress.set(id, next);
    this.scheduleFlush();
  }

  public complete(id: string) {
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }
    this.pendingProgress.delete(id);
    const next: Job = { ...job, status: 'completed', progress: 100, completedAt: Date.now() };
    this.jobs.set(id, next);
    this.emit({ type: 'job', job: next });
    this.scheduleCleanup(id);
  }

  public fail(id: string, error: string) {
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }
    this.pendingProgress.delete(id);
    const next: Job = { ...job, status: 'failed', error, completedAt: Date.now() };
    this.jobs.set(id, next);
    this.emit({ type: 'job', job: next });
    this.scheduleCleanup(id);
  }

  public dismiss(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === 'running') {
      return false;
    }
    this.remove(id);
    return true;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(update: JobUpdate) {
    for (const listener of this.listeners) {
      listener(update);
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const items = Array.from(this.pendingProgress.values());
      this.pendingProgress.clear();
      for (const job of items) {
        this.emit({ type: 'job', job });
      }
    }, PROGRESS_THROTTLE_MS);
  }

  private scheduleCleanup(id: string) {
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => this.remove(id), COMPLETED_TTL_MS);
    this.timers.set(id, timer);
  }

  private remove(id: string) {
    if (!this.jobs.delete(id)) {
      return;
    }
    this.pendingProgress.delete(id);
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.emit({ type: 'remove', id });
  }
}

export const jobStore = new JobStore();

export function newJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
