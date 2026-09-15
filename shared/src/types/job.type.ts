export type JobStatus = 'running' | 'completed' | 'failed';

export type JobType = 'model_pull' | 'model_import' | 'backend_install';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  label: string;
  target?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export type JobStreamEvent = { event: 'snapshot'; data: Job[] } | { event: 'job'; data: Job } | { event: 'remove'; data: { id: string } };
