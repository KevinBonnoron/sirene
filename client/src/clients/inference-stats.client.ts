import { universalClient, withFetchDelegate, withMethods } from 'universal-client';
import { authInterceptor } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

export interface GpuStats {
  index: number;
  name: string;
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
}

export interface ServerStats {
  device: string;
  cpu: { percent: number; cores: number };
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  gpus: GpuStats[];
  loadedModels: string[];
  history?: StatsSample[];
  historySeconds?: number;
}

export interface StatsSample {
  t: number;
  cpu: number;
  memory: number;
  gpu: number | null;
  vram: number | null;
}

export const inferenceStatsClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    get: (serverId: string, history = false) => delegate.get<ServerStats>(`/inference-servers/${encodeURIComponent(serverId)}/stats${history ? '?history=true' : ''}`),
  })),
);

export interface WorkerLogLine {
  time: string;
  level: string;
  logger: string;
  message: string;
}

export const inferenceDetailClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    logs: (serverId: string, limit = 200, level = '') => delegate.get<{ lines: WorkerLogLine[]; capacity: number }>(`/inference-servers/${encodeURIComponent(serverId)}/logs?limit=${limit}&level=${encodeURIComponent(level)}`),
  })),
);
