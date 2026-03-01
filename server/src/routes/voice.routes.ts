import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import JSZip from 'jszip';
import { z } from 'zod';
import { config } from '../lib/config';
import type { AuthEnv } from '../middleware';
import { voiceRepository, voiceSampleRepository } from '../repositories';

const idParamSchema = z.object({ id: z.string().min(1) });

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

export const voiceRoutes = new Hono<AuthEnv>()
  .post('/import', async (c) => {
    const userId = c.get('userId') as string;
    const formData = await c.req.formData();
    const zipFile = formData.get('file') as File | null;

    if (!zipFile) {
      return c.json({ error: 'A .zip file is required' }, 400);
    }

    const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());

    const voiceFile = zip.file('voice.json');
    if (!voiceFile) {
      return c.json({ error: 'Invalid archive: missing voice.json' }, 400);
    }
    const data = JSON.parse(await voiceFile.async('text'));

    let voiceName = data.name;
    const existing = await voiceRepository.getAllBy(`user = "${userId}" && name ~ "${data.name}"`);
    if (existing.some((v) => v.name === voiceName)) {
      const siblings = existing.map((v) => v.name);
      let n = 2;
      while (siblings.includes(`${data.name} (${n})`)) {
        n++;
      }
      voiceName = `${data.name} (${n})`;
    }

    const voiceForm = new FormData();
    voiceForm.append('name', voiceName);
    voiceForm.append('description', data.description || '');
    voiceForm.append('language', data.language || '');
    voiceForm.append('model', data.model || '');
    voiceForm.append('options', JSON.stringify(data.options || {}));
    voiceForm.append('tags', JSON.stringify(data.tags || []));
    voiceForm.append('user', userId);

    if (data.avatar) {
      const avatarData = zip.file(data.avatar);
      if (avatarData) {
        const avatarBuffer = await avatarData.async('uint8array');
        const ext = data.avatar.split('.').pop() || 'png';
        voiceForm.append('avatar', new Blob([avatarBuffer], { type: `image/${ext}` }), data.avatar);
      }
    }

    const createdVoice = await voiceRepository.create(voiceForm);

    if (Array.isArray(data.samples)) {
      for (const [i, sample] of data.samples.entries()) {
        const audioFile = zip.file(`samples/${sample.file}`);
        if (!audioFile) {
          continue;
        }

        const audioBuffer = await audioFile.async('uint8array');
        const sampleForm = new FormData();
        sampleForm.append('voice', createdVoice.id);
        sampleForm.append('transcript', sample.transcript || '');
        sampleForm.append('duration', String(sample.duration || 0));
        sampleForm.append('order', String(sample.order ?? i));
        sampleForm.append('enabled', 'true');
        sampleForm.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), sample.file);

        await voiceSampleRepository.create(sampleForm);
      }
    }

    return c.json(createdVoice, 201);
  })

  .get('', async (c) => {
    const userId = c.get('userId');
    const voices = await voiceRepository.getAllBy(`user = "${userId}" || (public = true && user != "")`);
    return c.json(voices);
  })

  .get('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const voice = await voiceRepository.getOne(id);
    if (!voice) {
      return c.json({ error: 'Voice not found' }, 404);
    }

    return c.json(voice);
  })

  .post('', async (c) => {
    const userId = c.get('userId');
    const formData = await c.req.formData();
    formData.append('user', userId);
    const voice = await voiceRepository.create(formData);
    return c.json(voice, 201);
  })

  .put('/:id', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const formData = await c.req.formData();
    const voice = await voiceRepository.update(id, formData);
    return c.json(voice);
  })

  .get('/:id/export', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const voice = await voiceRepository.getOne(id);
    if (!voice) {
      return c.json({ error: 'Voice not found' }, 404);
    }

    const zip = new JSZip();

    const samples = await voiceSampleRepository.getAllBy(`voice = "${id}"`, { sort: 'order,created' });

    const samplesData: Array<{ file: string; transcript: string; duration: number; order: number }> = [];
    const samplesDir = zip.folder('samples') as JSZip;

    for (const [i, sample] of samples.entries()) {
      const ext = sample.audio.split('.').pop() || 'wav';
      const filename = `sample-${String(i + 1).padStart(3, '0')}.${ext}`;

      const audioUrl = `${config.pb.url}/api/files/voice_samples/${sample.id}/${sample.audio}`;
      const audioResponse = await fetch(audioUrl);
      if (audioResponse.ok) {
        samplesDir.file(filename, await audioResponse.arrayBuffer());
      }

      samplesData.push({
        file: filename,
        transcript: sample.transcript || '',
        duration: sample.duration || 0,
        order: sample.order ?? i,
      });
    }

    const voiceJson = {
      name: voice.name,
      description: voice.description || '',
      language: voice.language || '',
      model: voice.model || '',
      options: voice.options ?? {},
      tags: voice.tags ?? [],
      avatar: voice.avatar || null,
      samples: samplesData,
    };
    zip.file('voice.json', JSON.stringify(voiceJson, null, 2));

    if (voice.avatar) {
      const avatarUrl = `${config.pb.url}/api/files/voices/${id}/${voice.avatar}`;
      const avatarResponse = await fetch(avatarUrl);
      if (avatarResponse.ok) {
        zip.file(voice.avatar, await avatarResponse.arrayBuffer());
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
    const downloadName = `voice-${voice.name.replace(/\s+/g, '-').toLowerCase()}.zip`;

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  })

  .get('/:id/samples', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const samples = await voiceSampleRepository.getAllBy(`voice = "${id}"`, { sort: 'order,created' });
    return c.json(samples);
  })

  .post('/:id/samples', zValidator('param', idParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const formData = await c.req.formData();
    const audioFile = formData.get('audio') as File | null;
    const transcript = (formData.get('transcript') as string) || '';

    if (!audioFile) {
      return c.json({ error: 'audio file is required' }, 400);
    }

    const existingSamples = await voiceSampleRepository.getAllBy(`voice = "${id}"`);
    const nextOrder = existingSamples.length;

    const duration = await getAudioDuration(await audioFile.arrayBuffer());

    const sampleForm = new FormData();
    sampleForm.append('audio', audioFile);
    sampleForm.append('transcript', transcript);
    sampleForm.append('duration', String(Math.round(duration * 10) / 10));
    sampleForm.append('voice', id);
    sampleForm.append('order', String(nextOrder));
    sampleForm.append('enabled', 'true');
    const sample = await voiceSampleRepository.create(sampleForm);

    return c.json(sample, 201);
  });
