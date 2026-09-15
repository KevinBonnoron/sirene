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
  process: { rss: number };
  disk: { used: number; total: number };
  gpus: GpuStats[];
  loadedModels: string[];
}

export const inferenceStatsClient = universalClient(
  withFetchDelegate(config.server.url, authInterceptor),
  withMethods(({ delegate }) => ({
    get: (serverId: string) => delegate.get<ServerStats>(`/inference-servers/${encodeURIComponent(serverId)}/stats`),
  })),
);
