export type JobStatus = 'running' | 'completed' | 'failed';

export type JobType = 'model_pull' | 'model_import' | 'backend_install';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  /** Integer 0-100. */
  progress: number;
  /** Short human-readable label, e.g. "Downloading kokoro-fr". */
  label: string;
  /** Domain-specific reference: model id, backend name, etc. */
  target?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export type JobStreamEvent = { event: 'snapshot'; data: Job[] } | { event: 'job'; data: Job } | { event: 'remove'; data: { id: string } };
