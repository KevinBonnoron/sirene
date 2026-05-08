import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Voice, VoiceSample } from '@sirene/shared';
import JSZip from 'jszip';
import { BadRequestError, NotFoundError } from '../errors';
import { config } from '../lib/config';
import { voiceRepository, voiceSampleRepository } from '../repositories';

interface ImportedSample {
  file: string;
  transcript?: string;
  duration?: number;
  order?: number;
}

interface VoiceArchive {
  name: string;
  description?: string;
  language?: string;
  model?: string;
  options?: Record<string, unknown>;
  tags?: string[];
  avatar?: string | null;
  samples?: ImportedSample[];
}

interface ExportedVoice {
  buffer: Uint8Array;
  filename: string;
}

class VoiceService {
  public async listForUser(userId: string): Promise<Voice[]> {
    return voiceRepository.getAllBy(`user = "${userId}" || (public = true && user != "")`) as Promise<Voice[]>;
  }

  public async getById(id: string): Promise<Voice> {
    const voice = (await voiceRepository.getOne(id)) as Voice | null;
    if (!voice) {
      throw new NotFoundError('Voice not found');
    }
    return voice;
  }

  public async create(userId: string, formData: FormData): Promise<Voice> {
    formData.append('user', userId);
    return voiceRepository.create(formData) as Promise<Voice>;
  }

  public async update(id: string, formData: FormData): Promise<Voice> {
    return voiceRepository.update(id, formData) as Promise<Voice>;
  }

  public async listSamples(voiceId: string): Promise<VoiceSample[]> {
    return voiceSampleRepository.getAllBy(`voice = "${voiceId}"`, { sort: 'order,created' }) as Promise<VoiceSample[]>;
  }

  /** Adds a new sample to an existing voice, computing its duration with ffprobe
   *  so the UI can display it without a second pass. */
  public async addSample(voiceId: string, audio: File, transcript: string): Promise<VoiceSample> {
    const existing = await voiceSampleRepository.getAllBy(`voice = "${voiceId}"`);
    const duration = await getAudioDuration(await audio.arrayBuffer());

    const sampleForm = new FormData();
    sampleForm.append('audio', audio);
    sampleForm.append('transcript', transcript);
    sampleForm.append('duration', String(Math.round(duration * 10) / 10));
    sampleForm.append('voice', voiceId);
    sampleForm.append('order', String(existing.length));
    sampleForm.append('enabled', 'true');
    return voiceSampleRepository.create(sampleForm) as Promise<VoiceSample>;
  }

  /** Reads a voice export zip and recreates the voice + its samples for the user.
   *  De-duplicates the name against the user's existing voices ("Foo (2)", etc.). */
  public async importFromZip(userId: string, zipBytes: ArrayBuffer): Promise<Voice> {
    const zip = await JSZip.loadAsync(zipBytes);
    const voiceFile = zip.file('voice.json');
    if (!voiceFile) {
      throw new BadRequestError('Invalid archive: missing voice.json');
    }
    let data: VoiceArchive;
    try {
      data = JSON.parse(await voiceFile.async('text')) as VoiceArchive;
    } catch {
      throw new BadRequestError('Invalid archive: voice.json is not valid JSON');
    }
    if (typeof data?.name !== 'string' || data.name.length === 0) {
      throw new BadRequestError('Invalid archive: voice.json is missing a "name" field');
    }

    const voiceName = await this.dedupeName(userId, data.name);

    const voiceForm = new FormData();
    voiceForm.append('name', voiceName);
    voiceForm.append('description', data.description ?? '');
    voiceForm.append('language', data.language ?? '');
    voiceForm.append('model', data.model ?? '');
    voiceForm.append('options', JSON.stringify(data.options ?? {}));
    voiceForm.append('tags', JSON.stringify(data.tags ?? []));
    voiceForm.append('user', userId);

    if (data.avatar) {
      const avatarFile = zip.file(data.avatar);
      if (avatarFile) {
        const bytes = await avatarFile.async('uint8array');
        const ext = data.avatar.split('.').pop() ?? 'png';
        voiceForm.append('avatar', new Blob([bytes], { type: `image/${ext}` }), data.avatar);
      }
    }

    const created = (await voiceRepository.create(voiceForm)) as Voice;

    if (Array.isArray(data.samples)) {
      for (const [i, sample] of data.samples.entries()) {
        const audio = zip.file(`samples/${sample.file}`);
        if (!audio) {
          continue;
        }
        const bytes = await audio.async('uint8array');
        const sampleForm = new FormData();
        sampleForm.append('voice', created.id);
        sampleForm.append('transcript', sample.transcript ?? '');
        sampleForm.append('duration', String(sample.duration ?? 0));
        sampleForm.append('order', String(sample.order ?? i));
        sampleForm.append('enabled', 'true');
        sampleForm.append('audio', new Blob([bytes], { type: 'audio/wav' }), sample.file);
        await voiceSampleRepository.create(sampleForm);
      }
    }

    return created;
  }

  /** Bundles a voice + its samples + avatar into a downloadable zip. */
  public async exportToZip(id: string): Promise<ExportedVoice> {
    const voice = await this.getById(id);
    const samples = await this.listSamples(id);

    const zip = new JSZip();
    const samplesDir = zip.folder('samples') as JSZip;

    const samplesData: ImportedSample[] = [];
    for (const [i, sample] of samples.entries()) {
      const ext = sample.audio.split('.').pop() ?? 'wav';
      const filename = `sample-${String(i + 1).padStart(3, '0')}.${ext}`;

      const audioUrl = `${config.pb.url}/api/files/voice_samples/${sample.id}/${sample.audio}`;
      let audioResponse: Response;
      try {
        audioResponse = await fetchWithTimeout(audioUrl);
      } catch (err) {
        // Network / DNS / TLS / timeout. Skip the sample entirely so the archive
        // doesn't reference an audio file we couldn't actually attach.
        console.warn(`[voice export] Failed to fetch sample ${sample.id}:`, err);
        continue;
      }
      if (!audioResponse.ok) {
        // Skip sample entirely when its audio can't be fetched -- otherwise the
        // archive would list a `samples/<file>` reference in voice.json that has
        // no matching file in the zip, and the importer would silently drop it.
        console.warn(`[voice export] Failed to fetch sample ${sample.id} (${audioResponse.status}); excluding from archive`);
        continue;
      }
      samplesDir.file(filename, await audioResponse.arrayBuffer());

      samplesData.push({
        file: filename,
        transcript: sample.transcript || '',
        duration: sample.duration || 0,
        order: sample.order ?? i,
      });
    }

    const archive: VoiceArchive = {
      name: voice.name,
      description: voice.description || '',
      language: voice.language || '',
      model: voice.model || '',
      options: voice.options ?? {},
      tags: voice.tags ?? [],
      avatar: voice.avatar || null,
      samples: samplesData,
    };
    zip.file('voice.json', JSON.stringify(archive, null, 2));

    if (voice.avatar) {
      const avatarUrl = `${config.pb.url}/api/files/voices/${id}/${voice.avatar}`;
      try {
        const avatarResponse = await fetchWithTimeout(avatarUrl);
        if (avatarResponse.ok) {
          zip.file(voice.avatar, await avatarResponse.arrayBuffer());
        }
      } catch (err) {
        console.warn(`[voice export] Failed to fetch avatar ${voice.avatar}:`, err);
      }
    }

    const buffer = await zip.generateAsync({ type: 'uint8array' });
    const filename = `voice-${voice.name.replace(/\s+/g, '-').toLowerCase()}.zip`;
    return { buffer, filename };
  }

  private async dedupeName(userId: string, name: string): Promise<string> {
    // Match the exact name OR the "name (N)" suffix pattern. PB's `~` is a
    // substring search, so a plain `name ~ "Alex"` would also collide with
    // "Alexander" and bump the suffix unnecessarily.
    const siblings = await voiceRepository.getAllBy(`user = "${userId}" && (name = "${name}" || name ~ "${name} (")`);
    const taken = new Set(siblings.map((v) => v.name));
    if (!taken.has(name)) {
      return name;
    }
    let n = 2;
    while (taken.has(`${name} (${n})`)) {
      n++;
    }
    return `${name} (${n})`;
  }
}

/** `fetch` has no built-in timeout. PB file URLs hit the local PB server and
 *  almost always answer within milliseconds, but a stalled remote can otherwise
 *  freeze the whole export until the route times out. 10s is generous for a
 *  local file fetch and short enough not to feel hung. */
function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

async function getAudioDuration(buffer: ArrayBuffer): Promise<number> {
  const tmpPath = join(tmpdir(), `audio-duration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmpPath, new Uint8Array(buffer));
    const proc = Bun.spawn(['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmpPath]);
    const output = await new Response(proc.stdout).text();
    return parseFloat(output.trim()) || 0;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export const voiceService = new VoiceService();
