import type { Generation, Session, Voice } from '@sirene/shared';
import { zipSync } from 'fflate';
import { pb } from '@/lib/pocketbase';

interface SessionExportInput {
  session: Session;
  generations: Generation[];
  voices: Voice[];
}

interface ManifestEntry {
  index: number;
  text: string;
  voice: string;
  model: string;
  duration: number;
  audio: string;
}

interface Manifest {
  session: { id: string; name: string; createdAt: string };
  takes: ManifestEntry[];
  exportedAt: string;
}

/** Slugify a session name for the zip file root. Falls back to the session id when the name is empty. */
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session'
  );
}

function inferExtension(mime: string | null, filename: string): string {
  if (filename.includes('.')) {
    const ext = filename.split('.').pop();
    if (ext) {
      return ext;
    }
  }
  if (mime?.includes('mpeg')) {
    return 'mp3';
  }
  if (mime?.includes('wav')) {
    return 'wav';
  }
  return 'audio';
}

async function fetchAudio(url: string): Promise<{ data: Uint8Array; mime: string | null }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  return { data: new Uint8Array(buf), mime: res.headers.get('content-type') };
}

/**
 * Build a ZIP of the session's audio files + a manifest JSON, then trigger a browser download.
 *
 * The manifest is the durable record — it captures order, voice, text, and per-file paths so the
 * archive is interpretable without context. Audio files keep their original encoding (whatever
 * the backend produced — typically wav for local backends, mp3 for ElevenLabs/OpenAI).
 */
export async function exportSessionAsZip({ session, generations, voices }: SessionExportInput): Promise<void> {
  const orderedIds = Array.isArray(session.generations) ? session.generations : [];
  const ordered = orderedIds.map((id) => generations.find((g) => g.id === id)).filter((g): g is Generation => Boolean(g));

  const slug = slugify(session.name?.trim() || session.id);
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = {
    session: { id: session.id, name: session.name ?? '', createdAt: session.created },
    takes: [],
    exportedAt: new Date().toISOString(),
  };

  for (let i = 0; i < ordered.length; i++) {
    const gen = ordered[i];
    if (!gen.audio) {
      continue;
    }
    const url = pb.files.getURL(gen, gen.audio);
    const { data, mime } = await fetchAudio(url);
    const ext = inferExtension(mime, gen.audio);
    const padded = String(i + 1).padStart(2, '0');
    const path = `${slug}/${padded}-take.${ext}`;

    files[path] = data;
    const voiceName = voices.find((v) => v.id === gen.voice)?.name ?? gen.voice;
    manifest.takes.push({
      index: i + 1,
      text: gen.text,
      voice: voiceName,
      model: gen.model,
      duration: gen.duration ?? 0,
      audio: path,
    });
  }

  files[`${slug}/manifest.json`] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files, { level: 0 });
  // fflate returns a Uint8Array view that may be backed by a SharedArrayBuffer-like buffer in some
  // environments; copy into a fresh ArrayBuffer to keep Blob happy across browsers.
  const out = new Uint8Array(zipped);
  const blob = new Blob([out], { type: 'application/zip' });
  const dlUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = dlUrl;
  a.download = `${slug}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(dlUrl);
}
