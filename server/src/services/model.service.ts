import { type Dirent, watch } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { CatalogModel, Model, PresetVoice } from '@sirene/shared';
import { config } from '../lib/config';
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
  private debounceTimer: Timer | null = null;

  public async scanCustomModels(): Promise<CatalogModel[]> {
    const catalogIds = new Set(modelsCatalog.map((m) => m.id));
    const custom: CatalogModel[] = [];

    let entries: Dirent<string>[];
    try {
      entries = await readdir(config.modelsPath, { encoding: 'utf8', withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || catalogIds.has(entry.name)) {
        continue;
      }

      const modelDir = join(config.modelsPath, entry.name);
      const onnxFiles = await this.findOnnxFiles(modelDir);
      const [onnxPath] = onnxFiles;
      if (!onnxPath) {
        continue;
      }

      const configPath = `${onnxPath}.json`;

      let configData: Record<string, unknown>;
      try {
        configData = JSON.parse(await readFile(configPath, 'utf-8'));
      } catch {
        continue;
      }

      if (!configData.espeak || !configData.phoneme_id_map) {
        continue;
      }

      const onnxStat = await stat(onnxPath);
      const espeakVoice = (configData.espeak as Record<string, string>).voice ?? '';
      const parts = entry.name.replace(/^piper-/, '').split('-');
      const locale = parts[0]?.split('_')[0]?.toUpperCase() ?? espeakVoice.toUpperCase();
      const speaker = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : 'Custom';

      const speakerMap = (configData.speaker_id_map ?? {}) as Record<string, number>;
      const numSpeakers = (configData.num_speakers as number) ?? 1;
      let presetVoices: PresetVoice[];

      if (numSpeakers > 1 && Object.keys(speakerMap).length > 0) {
        presetVoices = Object.keys(speakerMap).map((name) => ({ id: name, label: name }));
      } else {
        presetVoices = [{ id: 'default', label: speaker }];
      }

      custom.push({
        id: entry.name,
        name: `Piper ${locale} ${speaker}`,
        backend: 'piper',
        backendDisplayName: 'Piper',
        backendDescription: 'Fast and lightweight offline TTS with a wide range of languages.',
        description: `Piper — custom voice (${espeakVoice}).`,
        repo: '',
        files: [relative(modelDir, onnxPath), relative(modelDir, configPath)],
        size: onnxStat.size,
        types: ['preset'],
        presetVoices,
      });
    }

    return custom;
  }

  public getDownloadState(modelId: string) {
    return this.activeDownloads.get(modelId) ?? null;
  }

  public async isModelInstalled(catalog: CatalogModel): Promise<boolean> {
    if (catalog.types.includes('api')) {
      return true;
    }
    const modelDir = join(config.modelsPath, catalog.id);
    try {
      for (const entry of catalog.files) {
        const filePath = typeof entry === 'string' ? entry : entry.path;
        await stat(join(modelDir, filePath));
      }
      return true;
    } catch {
      return false;
    }
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

      if (catalog.types.includes('api') || (await this.isModelInstalled(catalog))) {
        models.push({ id: catalog.id, status: 'installed', progress: 100 });
      }
    }

    return models;
  }

  public async downloadModel({ catalog, onProgress, onComplete, onError }: DownloadOptions) {
    const destDir = join(config.modelsPath, catalog.id);
    await mkdir(destDir, { recursive: true });

    const totalSize = catalog.size;
    let totalDownloaded = 0;
    let lastReportedProgress = 0;

    try {
      for (const entry of catalog.files) {
        const filePath = typeof entry === 'string' ? entry : entry.path;
        const remotePath = typeof entry === 'string' ? entry : (entry.remotePath ?? entry.path);
        const repo = typeof entry === 'string' ? catalog.repo : (entry.repo ?? catalog.repo);
        const url = `${HF_BASE}/${repo}/resolve/main/${remotePath}`;
        const headers: Record<string, string> = {};
        const hfToken = await getSetting('hf_token');
        if (hfToken) {
          headers.Authorization = `Bearer ${hfToken}`;
        }

        const res = await fetch(url, { headers });

        if (!res.ok) {
          throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
        }

        if (!res.body) {
          throw new Error(`No response body for ${url}`);
        }

        const localPath = join(destDir, filePath);
        await mkdir(dirname(localPath), { recursive: true });
        const writer = Bun.file(localPath).writer();
        const reader = res.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          writer.write(value);
          totalDownloaded += value.byteLength;

          const progress = Math.floor((totalDownloaded / totalSize) * 100);
          if (progress > lastReportedProgress + 1) {
            lastReportedProgress = progress;
            const clamped = Math.min(progress, 99);
            this.setDownloadState(catalog.id, { progress: clamped });
            onProgress(clamped);
          }
        }

        await writer.end();
      }

      this.setDownloadState(catalog.id, null);
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.setDownloadState(catalog.id, { progress: lastReportedProgress, error: message });
      onError(message);
      await rm(destDir, { recursive: true, force: true }).catch(() => {});
      setTimeout(() => this.setDownloadState(catalog.id, null), 30_000);
    }
  }

  public async removeModelFiles(modelId: string) {
    const destDir = join(config.modelsPath, modelId);
    await rm(destDir, { recursive: true, force: true });
  }

  public addModelChangeListener(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async startModelWatcher() {
    await mkdir(config.modelsPath, { recursive: true });

    try {
      watch(config.modelsPath, { recursive: true }, () => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => this.notifyListeners(), 500);
      });
    } catch (err) {
      console.warn('Failed to start model watcher:', err);
    }
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

  private async findOnnxFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findOnnxFiles(full)));
      } else if (entry.name.endsWith('.onnx') && !entry.name.endsWith('.onnx.json')) {
        results.push(full);
      }
    }
    return results;
  }
}

export const modelService = new ModelService();
