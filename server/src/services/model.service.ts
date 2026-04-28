import type { CatalogModel, InferenceServer, Model } from '@sirene/shared';
import { deleteModel, importPiperModelToInference, pullModel } from '../lib/inference-client';
import { jobStore, newJobId } from '../lib/jobs';
import { getSetting } from '../lib/settings';
import { modelsCatalog } from '../manifest/models.manifest';
import { inferenceServerService } from './inference-server.service';
import { serverModelsService } from './server-models.service';

const HF_BASE = 'https://huggingface.co';

const API_KEY_MAP: Record<string, string> = {
  elevenlabs: 'elevenlabs_api_key',
  openai: 'openai_api_key',
};

type Listener = () => void;

function pullJobTarget(modelId: string, serverId: string): string {
  return `${modelId}::${serverId}`;
}

class ModelService {
  private readonly listeners = new Set<Listener>();

  public async scanCustomModels(): Promise<CatalogModel[]> {
    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    const custom = await serverModelsService.aggregatedCustom();
    return custom.filter((m) => !catalogIds.has(m.id));
  }

  public async isModelInstalled(catalog: CatalogModel): Promise<boolean> {
    if (catalog.types.includes('api')) {
      return true;
    }
    const servers = await serverModelsService.serversWithModel(catalog.id);
    return servers.length > 0;
  }

  public async getFullCatalog(userId?: string): Promise<CatalogModel[]> {
    const custom = await this.scanCustomModels();
    const all = [...modelsCatalog, ...custom];

    const filtered: CatalogModel[] = [];
    for (const model of all) {
      if (model.types.includes('api')) {
        const settingKey = API_KEY_MAP[model.backend];
        if (settingKey && !(await getSetting(settingKey, userId))) {
          continue;
        }
      }
      filtered.push(model);
    }

    return filtered;
  }

  public async getInstallations(catalogModels: CatalogModel[]): Promise<Model[]> {
    const byServer = await serverModelsService.getInstalledByServer();
    const models: Model[] = [];

    for (const catalog of catalogModels) {
      const serverIds: string[] = [];
      for (const [serverId, installed] of byServer) {
        if (installed.has(catalog.id)) {
          serverIds.push(serverId);
        }
      }

      const pullingJobs = jobStore.list().filter((j) => j.type === 'model_pull' && j.status === 'running' && j.target?.startsWith(`${catalog.id}::`));
      if (pullingJobs.length > 0) {
        const avg = Math.floor(pullingJobs.reduce((acc, j) => acc + j.progress, 0) / pullingJobs.length);
        models.push({ id: catalog.id, status: 'pulling', progress: avg, serverIds });
        continue;
      }

      if (catalog.types.includes('api') || serverIds.length > 0) {
        models.push({ id: catalog.id, status: 'installed', progress: 100, serverIds });
      }
    }

    return models;
  }

  /** Start a pull on the given servers (or all online servers if `serverIds` is omitted).
   *  Skips servers where the model is already installed. Returns one jobId per kicked-off
   *  pull, plus alreadyRunning=true if at least one matching pull was already in flight. */
  public async startModelDownload(catalog: CatalogModel, serverIds?: string[]): Promise<{ jobIds: string[]; alreadyRunning: boolean }> {
    const servers = await inferenceServerService.listEnabled();
    const onlineServers = servers.filter((s) => s.last_health_status === 'online' || !s.last_health_status || s.last_health_status === 'unknown');
    if (onlineServers.length === 0) {
      throw new Error('No online inference server available to pull this model.');
    }

    const requested = serverIds ? onlineServers.filter((s) => serverIds.includes(s.id)) : onlineServers;
    if (serverIds && requested.length !== serverIds.length) {
      const missing = serverIds.filter((id) => !onlineServers.some((s) => s.id === id));
      throw new Error(`Servers not online or not found: ${missing.join(', ')}`);
    }

    const byServer = await serverModelsService.getInstalledByServer();
    const targets = requested.filter((s) => !byServer.get(s.id)?.has(catalog.id));
    if (targets.length === 0) {
      throw new Error('Model is already installed on every selected server.');
    }

    const jobIds: string[] = [];
    let alreadyRunning = false;
    for (const server of targets) {
      const target = pullJobTarget(catalog.id, server.id);
      const existing = jobStore.findRunning('model_pull', target);
      if (existing) {
        jobIds.push(existing.id);
        alreadyRunning = true;
        continue;
      }
      const jobId = newJobId();
      jobStore.start({ id: jobId, type: 'model_pull', label: `${catalog.name} → ${server.name}`, target });
      void this.runDownload(jobId, catalog, server);
      jobIds.push(jobId);
    }
    return { jobIds, alreadyRunning };
  }

  private async runDownload(jobId: string, catalog: CatalogModel, server: InferenceServer) {
    const hfToken = await getSetting('hf_token');
    const files = catalog.files.map((entry) => {
      const filePath = typeof entry === 'string' ? entry : entry.path;
      const remotePath = typeof entry === 'string' ? entry : (entry.remotePath ?? entry.path);
      const repo = typeof entry === 'string' ? catalog.repo : (entry.repo ?? catalog.repo);
      return { url: `${HF_BASE}/${repo}/resolve/main/${remotePath}`, path: filePath };
    });

    try {
      for await (const event of pullModel(
        { url: server.url, authToken: server.auth_token },
        {
          backend: catalog.backend,
          modelId: catalog.id,
          files,
          totalSize: catalog.size,
          hfToken: hfToken ?? undefined,
        },
      )) {
        if (event.status === 'error') {
          throw new Error(typeof event.message === 'string' ? event.message : 'Pull failed');
        }
        if (event.status === 'downloading' || event.status === 'installing_deps') {
          const progress = typeof event.progress === 'number' ? Math.min(event.progress, 99) : 0;
          const label = event.status === 'installing_deps' ? `Installing ${catalog.backendDisplayName} deps → ${server.name}` : `${catalog.name} → ${server.name}`;
          jobStore.progress(jobId, progress, label);
        }
      }

      jobStore.complete(jobId);
      serverModelsService.invalidate(server.id);
      this.notifyListeners();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      jobStore.fail(jobId, message);
      serverModelsService.invalidate(server.id);
      this.notifyListeners();
    }
  }

  /** Fan out a Piper model upload to the given servers (or all online ones if `serverIds`
   *  is omitted). Skips servers where the slug is already installed. Each upload is its
   *  own job so partial failures (one server unreachable) don't block the rest. */
  public async startPiperImport(input: { slug: string; name: string; onnxBytes: ArrayBuffer; onnxName: string; onnxType: string; configBytes: ArrayBuffer; configName: string; configType: string; serverIds?: string[] }): Promise<{ jobIds: string[] }> {
    const { slug, name, onnxBytes, onnxName, onnxType, configBytes, configName, configType, serverIds } = input;

    const servers = await inferenceServerService.listEnabled();
    const onlineServers = servers.filter((s) => s.last_health_status === 'online' || !s.last_health_status || s.last_health_status === 'unknown');
    if (onlineServers.length === 0) {
      throw new Error('No online inference server available to import this model.');
    }

    const requested = serverIds ? onlineServers.filter((s) => serverIds.includes(s.id)) : onlineServers;
    if (serverIds && requested.length !== serverIds.length) {
      const missing = serverIds.filter((id) => !onlineServers.some((s) => s.id === id));
      throw new Error(`Servers not online or not found: ${missing.join(', ')}`);
    }

    const byServer = await serverModelsService.getInstalledByServer();
    const targets = requested.filter((s) => !byServer.get(s.id)?.has(slug));
    if (targets.length === 0) {
      throw new Error('Model is already installed on every selected server.');
    }

    const jobIds: string[] = [];
    for (const server of targets) {
      const jobId = newJobId();
      jobStore.start({ id: jobId, type: 'model_import', label: `Importing ${name} → ${server.name}`, target: pullJobTarget(slug, server.id) });
      void this.runPiperImport(jobId, server, name, { onnxBytes, onnxName, onnxType, configBytes, configName, configType });
      jobIds.push(jobId);
    }
    return { jobIds };
  }

  private async runPiperImport(jobId: string, server: InferenceServer, name: string, files: { onnxBytes: ArrayBuffer; onnxName: string; onnxType: string; configBytes: ArrayBuffer; configName: string; configType: string }) {
    try {
      // Build a fresh FormData per server — File/Blob hold the same underlying bytes
      // by reference so this stays cheap memory-wise.
      const fd = new FormData();
      fd.append('name', name);
      fd.append('onnx', new File([files.onnxBytes], files.onnxName, { type: files.onnxType }));
      fd.append('config', new File([files.configBytes], files.configName, { type: files.configType }));

      await importPiperModelToInference({ url: server.url, authToken: server.auth_token }, fd);

      jobStore.complete(jobId);
      serverModelsService.invalidate(server.id);
      this.notifyListeners();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      jobStore.fail(jobId, `${server.name}: ${message}`);
      serverModelsService.invalidate(server.id);
      this.notifyListeners();
    }
  }

  /** Delete the model from one server (when `serverId` is given) or every server that has it.
   *  Failures are aggregated so a single unreachable server doesn't block deletes elsewhere. */
  public async removeModelFiles(modelId: string, serverId?: string) {
    const byServer = await serverModelsService.getInstalledByServer();
    const servers = await inferenceServerService.listEnabled();
    let targets = servers.filter((s) => byServer.get(s.id)?.has(modelId));
    if (serverId) {
      targets = targets.filter((s) => s.id === serverId);
      if (targets.length === 0) {
        throw new Error(`Model is not installed on server "${serverId}".`);
      }
    }

    const errors: string[] = [];
    await Promise.all(
      targets.map(async (server) => {
        try {
          await deleteModel({ url: server.url, authToken: server.auth_token }, modelId);
          serverModelsService.invalidate(server.id);
        } catch (err) {
          errors.push(`${server.name}: ${err instanceof Error ? err.message : 'delete failed'}`);
        }
      }),
    );
    this.notifyListeners();
    if (errors.length > 0) {
      throw new Error(`Failed to delete on ${errors.length} server(s): ${errors.join('; ')}`);
    }
  }

  public addModelChangeListener(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Invalidate the per-server model cache and broadcast a change to subscribers.
   *  Call after a mutation that bypasses the regular pull/delete paths (e.g. piper import). */
  public markModelsChanged(serverId: string) {
    serverModelsService.invalidate(serverId);
    this.notifyListeners();
  }

  public startModelWatcher() {
    // Model files are managed by the inference server; no local watcher needed.
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const modelService = new ModelService();
