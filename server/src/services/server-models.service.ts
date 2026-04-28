import type { CatalogModel, InferenceServer } from '@sirene/shared';
import { getModels } from '../lib/inference-client';
import { inferenceServerService } from './inference-server.service';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  installed: Set<string>;
  custom: CatalogModel[];
  fetchedAt: number;
}

/** Per-server cache of which models are installed on which inference server.
 *  Refreshed lazily (60s TTL) and explicitly invalidated after pulls/deletes. */
class ServerModelsService {
  private readonly cache = new Map<string, CacheEntry>();

  /** Returns serverId -> installed model id set, only for enabled+online servers. */
  public async getInstalledByServer(): Promise<Map<string, Set<string>>> {
    const servers = await inferenceServerService.listEnabled();
    const result = new Map<string, Set<string>>();
    await Promise.all(
      servers.map(async (server) => {
        if (server.last_health_status === 'offline') {
          return;
        }
        const entry = await this.getEntry(server);
        result.set(server.id, entry.installed);
      }),
    );
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

  /** Aggregated custom (Piper) models across all online servers, deduped by id. */
  public async aggregatedCustom(): Promise<CatalogModel[]> {
    const servers = await inferenceServerService.listEnabled();
    const seen = new Map<string, CatalogModel>();
    await Promise.all(
      servers.map(async (server) => {
        if (server.last_health_status === 'offline') {
          return;
        }
        const entry = await this.getEntry(server);
        for (const model of entry.custom) {
          if (!seen.has(model.id)) {
            seen.set(model.id, model);
          }
        }
      }),
    );
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
    const cached = this.cache.get(server.id);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }
    const { installed, custom } = await getModels({ url: server.url, authToken: server.auth_token });
    const entry: CacheEntry = { installed: new Set(installed), custom, fetchedAt: Date.now() };
    this.cache.set(server.id, entry);
    return entry;
  }
}

export const serverModelsService = new ServerModelsService();
