import type { CatalogModel, InferenceServer, Model, PresetVoice } from '@sirene/shared';
import { pickTarget } from '../lib/inference-router';
import { jobStore, newJobId } from '../lib/jobs';
import { modelsCatalog } from '../manifest/models.manifest';
import { inferenceRepository } from '../repositories';
import { elevenlabsService } from './elevenlabs.service';
import { inferenceServerService } from './inference-server.service';
import { openAITtsService } from './openai-tts.service';
import { serverModelsService } from './server-models.service';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError, UpstreamError } from './service-error';
import { settingsService } from './settings.service';

/** Thrown when no inference server is online; HTTP route maps to 503. */
export class NoOnlineServerError extends ServiceUnavailableError {}

/** Thrown when the caller passed serverIds that don't match online servers; route maps to 400. */
export class InvalidServerSelectionError extends BadRequestError {}

/** Thrown when the model is already installed on every requested server; route maps to 409. */
export class ModelAlreadyInstalledError extends ConflictError {}

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
        if (settingKey && !(await settingsService.get(settingKey, userId))) {
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
    // 'unknown' (never probed yet) is treated as eligible alongside 'online' so a freshly
    // added server can accept jobs before the first 15s health-loop tick. Probe failures
    // mark the record 'offline' explicitly, so this can't accept a known-bad server.
    const onlineServers = servers.filter((s) => s.lastHealth.status === 'online' || !s.lastHealth.status || s.lastHealth.status === 'unknown');
    if (onlineServers.length === 0) {
      throw new NoOnlineServerError('No online inference server available to pull this model.');
    }

    // Dedupe so a payload like ["srv1","srv1"] doesn't make the length check fail
    // even though the only referenced server exists.
    const uniqueServerIds = serverIds ? Array.from(new Set(serverIds)) : undefined;
    const requested = uniqueServerIds ? onlineServers.filter((s) => uniqueServerIds.includes(s.id)) : onlineServers;
    if (uniqueServerIds && requested.length !== uniqueServerIds.length) {
      const missing = uniqueServerIds.filter((id) => !onlineServers.some((s) => s.id === id));
      throw new InvalidServerSelectionError(`Servers not online or not found: ${missing.join(', ')}`);
    }

    const byServer = await serverModelsService.getInstalledByServer();
    const targets = requested.filter((s) => !byServer.get(s.id)?.has(catalog.id));
    if (targets.length === 0) {
      throw new ModelAlreadyInstalledError('Model is already installed on every selected server.');
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
    const hfToken = await settingsService.get('hf_token');
    const files = catalog.files.map((entry) => {
      const filePath = typeof entry === 'string' ? entry : entry.path;
      const remotePath = typeof entry === 'string' ? entry : (entry.remotePath ?? entry.path);
      const repo = typeof entry === 'string' ? catalog.repo : (entry.repo ?? catalog.repo);
      return { url: `${HF_BASE}/${repo}/resolve/main/${remotePath}`, path: filePath };
    });

    try {
      for await (const event of inferenceRepository({ url: server.url, authToken: server.authToken }).pullModel({
        backend: catalog.backend,
        modelId: catalog.id,
        files,
        totalSize: catalog.size,
        hfToken: hfToken ?? undefined,
      })) {
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
    const onlineServers = servers.filter((s) => s.lastHealth.status === 'online' || !s.lastHealth.status || s.lastHealth.status === 'unknown');
    if (onlineServers.length === 0) {
      throw new NoOnlineServerError('No online inference server available to import this model.');
    }

    const uniqueServerIds = serverIds ? Array.from(new Set(serverIds)) : undefined;
    const requested = uniqueServerIds ? onlineServers.filter((s) => uniqueServerIds.includes(s.id)) : onlineServers;
    if (uniqueServerIds && requested.length !== uniqueServerIds.length) {
      const missing = uniqueServerIds.filter((id) => !onlineServers.some((s) => s.id === id));
      throw new InvalidServerSelectionError(`Servers not online or not found: ${missing.join(', ')}`);
    }

    const byServer = await serverModelsService.getInstalledByServer();
    const targets = requested.filter((s) => !byServer.get(s.id)?.has(slug));
    if (targets.length === 0) {
      throw new ModelAlreadyInstalledError('Model is already installed on every selected server.');
    }

    const jobIds: string[] = [];
    for (const server of targets) {
      const target = pullJobTarget(slug, server.id);
      // Reuse an in-flight import for the same slug+server. Two concurrent imports race
      // on the same files (PB record, models dir) and corrupt each other.
      const existing = jobStore.findRunning('model_import', target);
      if (existing) {
        jobIds.push(existing.id);
        continue;
      }
      const jobId = newJobId();
      jobStore.start({ id: jobId, type: 'model_import', label: `Importing ${name} → ${server.name}`, target });
      void this.runPiperImport(jobId, server, name, { onnxBytes, onnxName, onnxType, configBytes, configName, configType });
      jobIds.push(jobId);
    }
    return { jobIds };
  }

  private async runPiperImport(jobId: string, server: InferenceServer, name: string, files: { onnxBytes: ArrayBuffer; onnxName: string; onnxType: string; configBytes: ArrayBuffer; configName: string; configType: string }) {
    try {
      // Build a fresh FormData per server - File/Blob hold the same underlying bytes
      // by reference so this stays cheap memory-wise.
      const fd = new FormData();
      fd.append('name', name);
      fd.append('onnx', new File([files.onnxBytes], files.onnxName, { type: files.onnxType }));
      fd.append('config', new File([files.configBytes], files.configName, { type: files.configType }));

      await inferenceRepository({ url: server.url, authToken: server.authToken }).importPiperModel(fd);

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
        throw new NotFoundError(`Model is not installed on server "${serverId}".`);
      }
    }

    const errors: string[] = [];
    await Promise.all(
      targets.map(async (server) => {
        try {
          await inferenceRepository({ url: server.url, authToken: server.authToken }).deleteModel(modelId);
          serverModelsService.invalidate(server.id);
        } catch (err) {
          errors.push(`${server.name}: ${err instanceof Error ? err.message : 'delete failed'}`);
        }
      }),
    );
    this.notifyListeners();
    if (errors.length > 0) {
      throw new UpstreamError(`Failed to delete on ${errors.length} server(s): ${errors.join('; ')}`);
    }
  }

  /** Voices a model can produce. For ElevenLabs and OpenAI we read the live
   *  catalog from the upstream API; preset/cloning catalog models carry their
   *  own list. Throws NotFoundError when the model id is unknown. */
  public async listPresetVoicesFor(modelId: string, userId: string): Promise<PresetVoice[]> {
    const catalog = (await this.getFullCatalog(userId)).find((m) => m.id === modelId);
    if (!catalog) {
      throw new NotFoundError('Model not found');
    }
    if (catalog.backend === 'elevenlabs') {
      return elevenlabsService.listVoices(userId);
    }
    if (catalog.backend === 'openai') {
      return openAITtsService.listVoices();
    }
    return catalog.presetVoices ?? [];
  }

  /** Take an uploaded Piper bundle (onnx + config), validate it, derive the
   *  catalog slug from the espeak voice + sample rate, and fan the import out
   *  to the requested servers. The slug derivation is in here (not the route)
   *  because it's domain logic about how Piper models are named in the catalog. */
  public async importPiperFromUpload(input: { name: string; onnxFile: File; configFile: File; serverIds?: string[] }): Promise<{ slug: string; jobIds: string[] }> {
    const { name: rawName, onnxFile, configFile, serverIds } = input;
    const name = rawName.trim();
    if (!name) {
      throw new BadRequestError('Fields "onnx", "config", and "name" are required');
    }

    const configText = await configFile.text();
    let configData: Record<string, unknown>;
    try {
      configData = JSON.parse(configText) as Record<string, unknown>;
    } catch {
      throw new BadRequestError('Config file is not valid JSON');
    }
    if (!configData.espeak || !configData.phoneme_id_map) {
      throw new BadRequestError('Config must contain "espeak" and "phoneme_id_map" fields (Piper format)');
    }

    const espeakVoice = (configData.espeak as Record<string, string>).voice ?? '';
    const [langPart = '', regionPart] = espeakVoice.split('-');
    const locale = regionPart ? `${langPart.toLowerCase()}_${regionPart.toUpperCase()}` : langPart.toLowerCase();
    const sampleRate = (configData.audio as Record<string, number> | undefined)?.sample_rate ?? 22050;
    const quality = sampleRate <= 16000 ? 'low' : 'medium';
    const speakerSlug = name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    if (!speakerSlug) {
      throw new BadRequestError('Invalid model name');
    }
    const slug = `piper-${locale}-${speakerSlug}-${quality}`;

    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    if (catalogIds.has(slug)) {
      throw new ConflictError(`Name "${slug}" conflicts with an existing catalog model`);
    }

    // Read the file bytes once on Hono so we can fan out to multiple inference servers
    // without re-reading from the user's upload (which is a one-shot stream).
    const onnxBytes = await onnxFile.arrayBuffer();
    const configBytes = new TextEncoder().encode(configText).buffer as ArrayBuffer;

    const { jobIds } = await this.startPiperImport({
      slug,
      name,
      onnxBytes,
      onnxName: onnxFile.name || `${speakerSlug}.onnx`,
      onnxType: onnxFile.type || 'application/octet-stream',
      configBytes,
      configName: configFile.name || `${speakerSlug}.onnx.json`,
      configType: configFile.type || 'application/json',
      serverIds,
    });
    return { slug, jobIds };
  }

  /** Pull the export zip for a custom model from whichever server has it.
   *  Returns the upstream Response so the caller can pipe it through unbuffered.
   *  Throws NotFoundError when the model isn't a known custom model, and
   *  UpstreamError for transport / non-2xx upstream responses. */
  public async exportCustomModel(modelId: string): Promise<Response> {
    const customs = await this.scanCustomModels();
    if (!customs.find((m) => m.id === modelId)) {
      throw new NotFoundError('Custom model not found');
    }
    const target = await pickTarget({ requireModel: modelId });
    const response = await inferenceRepository(target).fetchExport(modelId);
    if (!response.ok) {
      throw new UpstreamError('Export failed');
    }
    return response;
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
