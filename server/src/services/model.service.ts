import type { CatalogModel, Model } from '@sirene/shared';
import { deleteModel, getInstalledModels, pullModel, scanCustomPiperModels } from '../lib/inference-client';
import { getSetting } from '../lib/settings';
import { modelsCatalog } from '../manifest/models.manifest';

const HF_BASE = 'https://huggingface.co';

const API_KEY_MAP: Record<string, string> = {
  elevenlabs: 'elevenlabs_api_key',
  openai: 'openai_api_key',
};

interface DownloadOptions {
  catalog: CatalogModel;
  onProgress: (progress: number) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

type Listener = () => void;

class ModelService {
  private readonly activeDownloads = new Map<string, { progress: number; error?: string }>();
  private readonly listeners = new Set<Listener>();

  public async scanCustomModels(): Promise<CatalogModel[]> {
    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    const all = await scanCustomPiperModels();
    return all.filter((m) => !catalogIds.has(m.id));
  }

  public getDownloadState(modelId: string) {
    return this.activeDownloads.get(modelId) ?? null;
  }

  public async isModelInstalled(catalog: CatalogModel): Promise<boolean> {
    if (catalog.types.includes('api')) {
      return true;
    }
    const installed = await getInstalledModels();
    return installed.includes(catalog.id);
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
    const installedIds = new Set(await getInstalledModels());
    const models: Model[] = [];

    for (const catalog of catalogModels) {
      const download = this.activeDownloads.get(catalog.id);
      if (download) {
        models.push({
          id: catalog.id,
          status: download.error ? 'error' : 'pulling',
          progress: download.progress,
          error: download.error,
        });
        continue;
      }

      if (catalog.types.includes('api') || installedIds.has(catalog.id)) {
        models.push({ id: catalog.id, status: 'installed', progress: 100 });
      }
    }

    return models;
  }

  public async downloadModel({ catalog, onProgress, onComplete, onError }: DownloadOptions) {
    this.setDownloadState(catalog.id, { progress: 0 });

    const hfToken = await getSetting('hf_token');
    const files = catalog.files.map((entry) => {
      const filePath = typeof entry === 'string' ? entry : entry.path;
      const remotePath = typeof entry === 'string' ? entry : (entry.remotePath ?? entry.path);
      const repo = typeof entry === 'string' ? catalog.repo : (entry.repo ?? catalog.repo);
      return { url: `${HF_BASE}/${repo}/resolve/main/${remotePath}`, path: filePath };
    });

    try {
      for await (const event of pullModel({
        backend: catalog.backend,
        modelId: catalog.id,
        files,
        totalSize: catalog.size,
        hfToken: hfToken ?? undefined,
      })) {
        if (event.status === 'downloading' || event.status === 'installing_deps') {
          const progress = typeof event.progress === 'number' ? Math.min(event.progress, 99) : 0;
          this.setDownloadState(catalog.id, { progress });
          onProgress(progress);
        }
      }

      this.setDownloadState(catalog.id, null);
      this.notifyListeners();
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.setDownloadState(catalog.id, { progress: 0, error: message });
      onError(message);
      setTimeout(() => this.setDownloadState(catalog.id, null), 30_000);
    }
  }

  public async removeModelFiles(modelId: string) {
    await deleteModel(modelId);
    this.notifyListeners();
  }

  public addModelChangeListener(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public startModelWatcher() {
    // Model files are managed by the inference server; no local watcher needed.
  }

  private setDownloadState(modelId: string, state: { progress: number; error?: string } | null) {
    if (state === null) {
      this.activeDownloads.delete(modelId);
    } else {
      this.activeDownloads.set(modelId, state);
    }
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const modelService = new ModelService();
