import type { InferenceServer, InferenceServerHealthStatus } from '@sirene/shared';
import { config } from '../lib/config';
import { inferenceServerRepository } from '../repositories';

const HEALTH_INTERVAL_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5_000;

class InferenceServerService {
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  public async listEnabled(): Promise<InferenceServer[]> {
    return inferenceServerRepository.getAllBy('enabled = true', { sort: '-priority' });
  }

  /** Probe one server and persist the result. Manual triggers always write so the user
   *  sees the timestamp move even when the status didn't change. */
  public async checkOne(id: string): Promise<InferenceServer | null> {
    const record = await inferenceServerRepository.getOne(id);
    if (!record) {
      return null;
    }
    const probed = await probeHealth(record.url);
    return this.persistHealth(record, probed, { force: true });
  }

  /** Bootstrap a single server from INFERENCE_URL if the registry is empty. */
  public async bootstrapFromEnv(): Promise<void> {
    const records = await inferenceServerRepository.getAllBy('', { sort: 'created' });
    if (records.length > 0) {
      return;
    }
    await inferenceServerRepository.create({
      name: 'Local',
      url: config.inferenceUrl.replace(/\/$/, ''),
      enabled: true,
      priority: 100,
      last_health_at: '',
      last_health_status: 'unknown',
      last_health_error: '',
    });
    console.log(`Seeded inference_servers with ${config.inferenceUrl}`);
  }

  public startHealthLoop(): void {
    if (this.healthTimer) {
      return;
    }
    void this.runHealthRound();
    this.healthTimer = setInterval(() => void this.runHealthRound(), HEALTH_INTERVAL_MS);
  }

  private async runHealthRound(): Promise<void> {
    const records = await inferenceServerRepository.getAllBy('', { sort: '-priority' });
    await Promise.all(
      records.map(async (record) => {
        const probed = await probeHealth(record.url);
        await this.persistHealth(record, probed);
      }),
    );
  }

  /** By default only writes when status or error changed (keeps PB realtime quiet during the
   *  15s health loop). Pass `force: true` for manual triggers to always update the timestamp. */
  private async persistHealth(record: InferenceServer, probed: { status: InferenceServerHealthStatus; error: string }, options: { force?: boolean } = {}): Promise<InferenceServer> {
    const currentStatus = (record.last_health_status || 'unknown') as InferenceServerHealthStatus;
    const currentError = record.last_health_error || '';
    if (!options.force && currentStatus === probed.status && currentError === probed.error) {
      return record;
    }
    return inferenceServerRepository.update(record.id, {
      last_health_at: new Date().toISOString(),
      last_health_status: probed.status,
      last_health_error: probed.error,
    });
  }
}

async function probeHealth(url: string): Promise<{ status: InferenceServerHealthStatus; error: string }> {
  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: 'offline', error: `HTTP ${response.status}` };
    }
    return { status: 'online', error: '' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    return { status: 'offline', error: message };
  }
}

export const inferenceServerService = new InferenceServerService();
