import type { CatalogModel, Model } from '@sirene/shared';
import { deleteModel, getModels, pullModel } from '../lib/inference-client';
import { jobStore, newJobId } from '../lib/jobs';
import { getSetting } from '../lib/settings';
import { modelsCatalog } from '../manifest/models.manifest';

const HF_BASE = 'https://huggingface.co';

const API_KEY_MAP: Record<string, string> = {
  elevenlabs: 'elevenlabs_api_key',
  openai: 'openai_api_key',
};

type Listener = () => void;

class ModelService {
  private readonly listeners = new Set<Listener>();

  public async scanCustomModels(): Promise<CatalogModel[]> {
    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    const { custom } = await getModels();
    return custom.filter((m) => !catalogIds.has(m.id));
  }

  public async isModelInstalled(catalog: CatalogModel): Promise<boolean> {
    if (catalog.types.includes('api')) {
      return true;
    }
    const { installed } = await getModels();
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
    const { installed } = await getModels();
    const installedIds = new Set(installed);
    const models: Model[] = [];

    for (const catalog of catalogModels) {
      const job = jobStore.findRunning('model_pull', catalog.id);
      if (job) {
        models.push({ id: catalog.id, status: 'pulling', progress: job.progress });
        continue;
      }

      if (catalog.types.includes('api') || installedIds.has(catalog.id)) {
        models.push({ id: catalog.id, status: 'installed', progress: 100 });
      }
    }

    return models;
  }

  /** Returns the existing job if one is already running for this model, else starts one. */
  public startModelDownload(catalog: CatalogModel): { jobId: string; alreadyRunning: boolean } {
    const existing = jobStore.findRunning('model_pull', catalog.id);
    if (existing) {
      return { jobId: existing.id, alreadyRunning: true };
    }

    const jobId = newJobId();
    jobStore.start({ id: jobId, type: 'model_pull', label: catalog.name, target: catalog.id });
    void this.runDownload(jobId, catalog);
    return { jobId, alreadyRunning: false };
  }

  private async runDownload(jobId: string, catalog: CatalogModel) {
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
        if (event.status === 'error') {
          throw new Error(typeof event.message === 'string' ? event.message : 'Pull failed');
        }
        if (event.status === 'downloading' || event.status === 'installing_deps') {
          const progress = typeof event.progress === 'number' ? Math.min(event.progress, 99) : 0;
          const label = event.status === 'installing_deps' ? `Installing ${catalog.backendDisplayName} dependencies` : catalog.name;
          jobStore.progress(jobId, progress, label);
        }
      }

      jobStore.complete(jobId);
      this.notifyListeners();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      jobStore.fail(jobId, message);
      this.notifyListeners();
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

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const modelService = new ModelService();
