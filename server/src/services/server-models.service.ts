import type { CatalogModel, InferenceServer } from '@sirene/shared';
import { getModels } from '../lib/inference-client';
import { inferenceServerService } from './inference-server.service';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  installed: Set<string>;
  custom: CatalogModel[];
  fetchedAt: number;
  /** Fingerprint of the server fields that affect what we'd fetch. If the server
   *  URL or auth token changes between calls, the fingerprint mismatches and the
   *  cache entry is treated as a miss even within the TTL. */
  fingerprint: string;
}

/** Per-server cache of which models are installed on which inference server.
 *  Refreshed lazily (60s TTL) and explicitly invalidated after pulls/deletes. */
class ServerModelsService {
  private readonly cache = new Map<string, CacheEntry>();

  /** Returns serverId -> installed model id set, only for enabled+online servers.
   *  One slow/timed-out probe must not break visibility for other healthy servers,
   *  so per-server failures are logged and skipped instead of rejecting the batch. */
  public async getInstalledByServer(): Promise<Map<string, Set<string>>> {
    const servers = await inferenceServerService.listEnabled();
    const result = new Map<string, Set<string>>();
    const settled = await Promise.allSettled(
      servers.map(async (server) => {
        if (server.last_health_status === 'offline') {
          return null;
        }
        const entry = await this.getEntry(server);
        return { id: server.id, installed: entry.installed };
      }),
    );
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === 'fulfilled' && outcome.value) {
        result.set(outcome.value.id, outcome.value.installed);
      } else if (outcome.status === 'rejected') {
        const server = servers[index];
        console.warn(`[server-models] failed to fetch models from ${server?.name ?? 'unknown'} (${server?.url ?? '?'}):`, outcome.reason);
      }
    }
    return result;
  }

  /** Servers (enabled+online) that have the given model installed. */
  public async serversWithModel(modelId: string): Promise<string[]> {
    const byServer = await this.getInstalledByServer();
    const out: string[] = [];
    for (const [serverId, installed] of byServer) {
      if (installed.has(modelId)) {
        out.push(serverId);
      }
    }
    return out;
  }

  /** Aggregated custom (Piper) models across all online servers, deduped by id.
   *  Same isolation policy as getInstalledByServer — one bad worker doesn't blank
   *  the catalog for everyone else. */
  public async aggregatedCustom(): Promise<CatalogModel[]> {
    const servers = await inferenceServerService.listEnabled();
    const seen = new Map<string, CatalogModel>();
    const settled = await Promise.allSettled(
      servers.map(async (server) => {
        if (server.last_health_status === 'offline') {
          return [];
        }
        const entry = await this.getEntry(server);
        return entry.custom;
      }),
    );
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === 'fulfilled') {
        for (const model of outcome.value) {
          if (!seen.has(model.id)) {
            seen.set(model.id, model);
          }
        }
      } else {
        const server = servers[index];
        console.warn(`[server-models] failed to fetch custom models from ${server?.name ?? 'unknown'} (${server?.url ?? '?'}):`, outcome.reason);
      }
    }
    return Array.from(seen.values());
  }

  /** Force a refresh for one server — call after pulls, deletes, or health recovery. */
  public invalidate(serverId: string): void {
    this.cache.delete(serverId);
  }

  public invalidateAll(): void {
    this.cache.clear();
  }

  private async getEntry(server: InferenceServer): Promise<CacheEntry> {
    const fingerprint = `${server.url}|${server.auth_token ?? ''}`;
    const cached = this.cache.get(server.id);
    if (cached && cached.fingerprint === fingerprint && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }
    const { installed, custom } = await getModels({ url: server.url, authToken: server.auth_token });
    const entry: CacheEntry = { installed: new Set(installed), custom, fetchedAt: Date.now(), fingerprint };
    this.cache.set(server.id, entry);
    return entry;
  }
}

export const serverModelsService = new ServerModelsService();
