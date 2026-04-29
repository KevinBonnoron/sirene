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

  /** Probe one server and persist the result. */
  public async checkOne(id: string): Promise<InferenceServer | null> {
    const record = await inferenceServerRepository.getOne(id);
    if (!record) {
      return null;
    }
    const probed = await probeHealth(record.url, record.auth_token);
    return this.persistHealth(record, probed);
  }

  /** Bootstrap a single server from INFERENCE_URL if the registry is empty. */
  public async bootstrapFromEnv(): Promise<void> {
    const records = await inferenceServerRepository.getAllBy('', { sort: 'created' });
    if (records.length > 0) {
      return;
    }
    // Idempotent under concurrent startup: the read above is racy across multiple
    // API instances, and the unique-name/url indexes will reject the loser. Treat
    // that case as success — by then another instance has already seeded the row.
    try {
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
    } catch (err) {
      const message = String((err as { message?: unknown })?.message ?? '').toLowerCase();
      if (message.includes('unique') || message.includes('already exists')) {
        return;
      }
      throw err;
    }
  }

  public startHealthLoop(): void {
    if (this.healthTimer) {
      return;
    }
    void this.runHealthRound().catch((err) => console.warn('[health] initial round failed', err));
    this.healthTimer = setInterval(() => {
      this.runHealthRound().catch((err) => console.warn('[health] round failed', err));
    }, HEALTH_INTERVAL_MS);
  }

  private async runHealthRound(): Promise<void> {
    // Skip disabled records: the user explicitly turned the server off, so we
    // shouldn't keep firing outbound HTTP probes at it (privacy + bandwidth).
    const records = await inferenceServerRepository.getAllBy('enabled = true', { sort: '-priority' });
    // allSettled so one server's probe/persist error doesn't tear down the whole round
    // and leak as an unhandled rejection from the timer callback.
    await Promise.allSettled(
      records.map(async (record) => {
        try {
          const probed = await probeHealth(record.url, record.auth_token);
          await this.persistHealth(record, probed);
        } catch (err) {
          console.warn(`[health] ${record.name} (${record.url}) probe failed:`, err);
        }
      }),
    );
  }

  /** Always advances `last_health_at` so the UI's "last checked" timestamp keeps moving
   *  while the 15s loop is running. Status/error fields are only written when they
   *  actually change to keep the PB realtime stream quiet for stable servers. */
  private async persistHealth(record: InferenceServer, probed: { status: InferenceServerHealthStatus; error: string }): Promise<InferenceServer> {
    const currentStatus = (record.last_health_status || 'unknown') as InferenceServerHealthStatus;
    const currentError = record.last_health_error || '';
    const statusChanged = currentStatus !== probed.status || currentError !== probed.error;
    const update: Partial<InferenceServer> = {
      last_health_at: new Date().toISOString(),
    };
    if (statusChanged) {
      update.last_health_status = probed.status;
      update.last_health_error = probed.error;
    }
    return inferenceServerRepository.update(record.id, update);
  }
}

async function probeHealth(url: string, authToken?: string): Promise<{ status: InferenceServerHealthStatus; error: string }> {
  try {
    // /health is unauthenticated by design (so liveness probes work without auth),
    // but if the worker was started in fail-closed mode and the operator decides to
    // require auth on every path, still send the bearer so the probe matches what
    // every other inference call does.
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      headers,
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
