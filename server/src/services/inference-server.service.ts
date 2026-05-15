import type { InferenceServer, InferenceServerHealthStatus } from '@sirene/shared';
import { NotFoundError } from '../errors';
import { config } from '../lib/config';
import { inferenceRepository, inferenceServerRepository } from '../repositories';
import { serverModelsService } from './server-models.service';

interface InferenceServerWriteInput {
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  authToken?: string;
}

type InferenceServerUpdateInput = Partial<InferenceServerWriteInput>;

const HEALTH_INTERVAL_MS = 15_000;

class InferenceServerService {
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  public async listEnabled(): Promise<InferenceServer[]> {
    return inferenceServerRepository.findAllBy('enabled = true', { sort: '-priority' });
  }

  /** Probe one server and persist the result. Throws NotFoundError on unknown id. */
  public async checkOne(id: string): Promise<InferenceServer> {
    const record = await inferenceServerRepository.findOne(id);
    if (!record) {
      throw new NotFoundError('inferenceServer.notFound', 'Inference server not found');
    }
    const probed = await probeHealth(record.url, record.authToken);
    const updated = await this.persistHealth(record, probed);
    serverModelsService.invalidate(id);
    return updated;
  }

  public async create(input: InferenceServerWriteInput): Promise<InferenceServer> {
    return inferenceServerRepository.create({
      ...input,
      url: input.url.replace(/\/$/, ''),
      lastHealth: { at: '', status: 'unknown', error: '' },
    });
  }

  public async update(id: string, input: InferenceServerUpdateInput): Promise<InferenceServer> {
    const payload = input.url ? { ...input, url: input.url.replace(/\/$/, '') } : input;
    const updated = await inferenceServerRepository.update(id, payload);
    // url / authToken / enabled changes invalidate the cached inventory for this
    // server - without this, routing would keep using the old endpoint for up to
    // the cache TTL.
    serverModelsService.invalidate(id);
    return updated;
  }

  public async remove(id: string): Promise<void> {
    await inferenceServerRepository.delete(id);
    serverModelsService.invalidate(id);
  }

  /** Bootstrap a single "Local" server from INFERENCE_URL. Idempotent: if a "Local"
   *  record already exists we just realign its URL with the current env, which keeps
   *  the desktop dev launcher working when ports change every boot. */
  public async bootstrapFromEnv(): Promise<void> {
    const url = config.inferenceUrl.replace(/\/$/, '');

    const existing = await inferenceServerRepository.findBy("name = 'Local'");
    if (existing) {
      if (existing.url !== url) {
        await inferenceServerRepository.update(existing.id, { url });
        console.log(`Updated 'Local' inference_server url to ${url}`);
      }
      return;
    }

    // User may have renamed the auto-seeded entry. Skip seeding if any record
    // exists at all - we don't want to keep recreating "Local" alongside it.
    const records = await inferenceServerRepository.findAllBy('', { sort: 'created' });
    if (records.length > 0) {
      return;
    }

    // Unique-name/url races across concurrent instances are still handled below.
    try {
      await inferenceServerRepository.create({
        name: 'Local',
        url,
        enabled: true,
        priority: 100,
        lastHealth: { at: '', status: 'unknown', error: '' },
      });
      console.log(`Seeded inference_servers with ${url}`);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return;
      }
      // PB's `ClientResponseError` puts the structured rejection in `response.data`,
      // and the default error inspector truncates it to `[Object ...]`. Log the body
      // explicitly so bootstrap failures are diagnosable instead of cryptic.
      const response = (err as { response?: unknown })?.response;
      console.error('Failed to seed inference_servers:', JSON.stringify(response, null, 2));
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
    const records = await inferenceServerRepository.findAllBy('enabled = true', { sort: '-priority' });
    // allSettled so one server's probe/persist error doesn't tear down the whole round
    // and leak as an unhandled rejection from the timer callback.
    await Promise.allSettled(
      records.map(async (record) => {
        try {
          const probed = await probeHealth(record.url, record.authToken);
          await this.persistHealth(record, probed);
        } catch (err) {
          console.warn(`[health] ${record.name} (${record.url}) probe failed:`, err);
        }
      }),
    );
  }

  /** Writes the full health snapshot on every probe. The three fields are atomically
   *  in sync as a single PB json column; PB realtime fires per-record anyway, so there's
   *  no traffic gain in updating only the changed sub-keys. */
  private async persistHealth(record: InferenceServer, probed: { status: InferenceServerHealthStatus; error: string }): Promise<InferenceServer> {
    return inferenceServerRepository.update(record.id, {
      lastHealth: { at: new Date().toISOString(), status: probed.status, error: probed.error },
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  const message = String((err as { message?: unknown })?.message ?? '').toLowerCase();
  if (message.includes('unique') || message.includes('already exists')) {
    return true;
  }
  // PB JS SDK exposes structured validation errors at `response.data` keyed by
  // field name. The unique-constraint code is `validation_not_unique`.
  const data = (err as { response?: { data?: Record<string, { code?: string }> } })?.response?.data;
  if (data && typeof data === 'object') {
    for (const entry of Object.values(data)) {
      if (entry?.code === 'validation_not_unique') {
        return true;
      }
    }
  }
  return false;
}

async function probeHealth(url: string, authToken?: string): Promise<{ status: InferenceServerHealthStatus; error: string }> {
  try {
    // /health is unauthenticated by design (so liveness probes work without auth),
    // but if the worker was started in fail-closed mode and the operator decides to
    // require auth on every path, still send the bearer so the probe matches what
    // every other inference call does.
    await inferenceRepository({ url, authToken }).health();
    return { status: 'online', error: '' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    return { status: 'offline', error: message };
  }
}

export const inferenceServerService = new InferenceServerService();
