import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Voice, VoiceSample } from '@sirene/shared';
import JSZip from 'jszip';
import { BadRequestError, NotFoundError, ServiceError } from '../errors';
import { voiceRepository, voiceSampleRepository } from '../repositories';
import { pbFilesService } from './pb-files.service';

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
    return voiceRepository.findAllBy('user = {:userId} || (public = true && user != "")', { params: { userId } }) as Promise<Voice[]>;
  }

  /** Read access: the owner, or any user when the voice is public. */
  public async getById(id: string, userId: string): Promise<Voice> {
    return this.requireReadable(id, userId);
  }

  public async create(userId: string, formData: FormData): Promise<Voice> {
    formData.append('user', userId);
    return voiceRepository.create(formData) as Promise<Voice>;
  }

  /** Write access: only the owner. */
  public async update(id: string, userId: string, formData: FormData): Promise<Voice> {
    await this.requireOwned(id, userId);
    return voiceRepository.update(id, formData) as Promise<Voice>;
  }

  public async listSamples(voiceId: string, userId: string): Promise<VoiceSample[]> {
    await this.requireReadable(voiceId, userId);
    return voiceSampleRepository.findAllBy('voice = {:voiceId}', { params: { voiceId }, sort: 'order,created' }) as Promise<VoiceSample[]>;
  }

  /** Adds a new sample to an existing voice, computing its duration with ffprobe
   *  so the UI can display it without a second pass. Owner-only. */
  public async addSample(voiceId: string, userId: string, audio: File, transcript: string): Promise<VoiceSample> {
    await this.requireOwned(voiceId, userId);
    const existing = await voiceSampleRepository.findAllBy('voice = {:voiceId}', { params: { voiceId } });
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

  /** Loads a voice and ensures the caller may read it (owner OR public).
   *  Returns NotFoundError on cross-user reads of private voices so the id
   *  space can't be probed. */
  private async requireReadable(id: string, userId: string): Promise<Voice> {
    const voice = (await voiceRepository.findOne(id)) as Voice | null;
    if (!voice || (voice.user !== userId && !voice.public)) {
      throw new NotFoundError('voice.notFound', 'Voice not found');
    }
    return voice;
  }

  /** Loads a voice and ensures the caller owns it. Used for write paths
   *  (update, addSample) where the public flag must not unlock mutations. */
  private async requireOwned(id: string, userId: string): Promise<Voice> {
    const voice = (await voiceRepository.findOne(id)) as Voice | null;
    if (!voice || voice.user !== userId) {
      throw new NotFoundError('voice.notFound', 'Voice not found');
    }
    return voice;
  }

  /** Reads a voice export zip and recreates the voice + its samples for the user.
   *  De-duplicates the name against the user's existing voices ("Foo (2)", etc.). */
  public async importFromZip(userId: string, zipBytes: ArrayBuffer): Promise<Voice> {
    const zip = await JSZip.loadAsync(zipBytes);
    const voiceFile = zip.file('voice.json');
    if (!voiceFile) {
      throw new BadRequestError('voice.archiveMissing', 'Invalid archive: missing voice.json');
    }
    let data: VoiceArchive;
    try {
      data = JSON.parse(await voiceFile.async('text')) as VoiceArchive;
    } catch {
      throw new BadRequestError('voice.archiveInvalidJson', 'Invalid archive: voice.json is not valid JSON');
    }
    if (typeof data?.name !== 'string' || data.name.length === 0) {
      throw new BadRequestError('voice.archiveMissingName', 'Invalid archive: voice.json is missing a "name" field');
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

    // PB has no cross-collection transactions, so on any sample-side failure
    // we compensate by deleting every record we managed to insert (samples
    // first, then the voice itself). Worst case the operator gets a logged
    // orphan; we never leave a half-imported voice visible to the user.
    const insertedSampleIds: string[] = [];
    try {
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
          const inserted = (await voiceSampleRepository.create(sampleForm)) as VoiceSample;
          insertedSampleIds.push(inserted.id);
        }
      }
    } catch (err) {
      await this.rollbackImport(created.id, insertedSampleIds);
      // Only re-wrap as `archiveInvalidJson` if we genuinely hit a JSON error
      // while parsing voice.json earlier; the rest of the try body covers
      // storage/network/repository errors that should keep their own shape so
      // operators can diagnose them. Service errors propagate unchanged.
      if (err instanceof ServiceError) {
        throw err;
      }
      if (err instanceof SyntaxError) {
        throw new BadRequestError('voice.archiveInvalidJson', 'Invalid archive: voice.json is not valid JSON');
      }
      throw err;
    }

    return created;
  }

  private async rollbackImport(voiceId: string, sampleIds: string[]): Promise<void> {
    for (const sampleId of sampleIds) {
      try {
        await voiceSampleRepository.delete(sampleId);
      } catch (err) {
        console.error('[voice/import] rollback: failed to delete sample', { sampleId, err });
      }
    }
    try {
      await voiceRepository.delete(voiceId);
    } catch (err) {
      console.error('[voice/import] rollback: failed to delete voice', { voiceId, err });
    }
  }

  /** Bundles a voice + its samples + avatar into a downloadable zip. Same
   *  read access model as getById: owner OR public. */
  public async exportToZip(id: string, userId: string): Promise<ExportedVoice> {
    const voice = await this.requireReadable(id, userId);
    const samples = (await voiceSampleRepository.findAllBy('voice = {:voiceId}', { params: { voiceId: id }, sort: 'order,created' })) as VoiceSample[];

    const zip = new JSZip();
    const samplesDir = zip.folder('samples') as JSZip;

    const samplesData: ImportedSample[] = [];
    for (const [i, sample] of samples.entries()) {
      const ext = sample.audio.split('.').pop() ?? 'wav';
      const filename = `sample-${String(i + 1).padStart(3, '0')}.${ext}`;

      const audioUrl = pbFilesService.url('voice_samples', sample.id, sample.audio);
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
      const avatarUrl = pbFilesService.url('voices', id, voice.avatar);
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
    // Voice names are user-controlled, so anything we drop into the
    // Content-Disposition header has to be filesystem-safe across browsers.
    // Strip everything outside [A-Za-z0-9_-] and collapse runs to a single dash.
    const safeName =
      voice.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'voice';
    const filename = `voice-${safeName}.zip`;
    return { buffer, filename };
  }

  private async dedupeName(userId: string, name: string): Promise<string> {
    // `name` is read straight out of the imported voice.json so it's
    // user-controlled - pb.filter() escapes single quotes / operators that
    // would otherwise break the predicate. Matches the exact name OR the
    // "name (N)" suffix pattern; the trailing space + `(` keeps "Alex" from
    // colliding with "Alexander" through PB's substring `~`.
    const siblings = await voiceRepository.findAllBy('user = {:userId} && (name = {:name} || name ~ {:prefix})', { params: { userId, name, prefix: `${name} (` } });
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
