import type { Voice, VoiceSample } from '@sirene/shared';
import { getJson } from '../api';
import { loadConfig } from '../config';
import { color } from '../utils';

export async function voiceListCommand(): Promise<void> {
  const config = await loadConfig();
  const voices = await getJson<Voice[]>(config, '/voices');

  if (voices.length === 0) {
    process.stdout.write('No voice available. Create one in the web UI first.\n');
    return;
  }

  const idWidth = Math.max(2, ...voices.map((v) => v.id.length));
  const nameWidth = Math.max(4, ...voices.map((v) => (v.name ?? '').length));
  process.stdout.write(`${color.bold('ID'.padEnd(idWidth))}  ${color.bold('NAME'.padEnd(nameWidth))}  LANGUAGE\n`);
  for (const voice of voices) {
    const id = voice.id.padEnd(idWidth);
    const name = (voice.name ?? '').padEnd(nameWidth);
    const language = voice.language ?? '';
    process.stdout.write(`${id}  ${name}  ${language}\n`);
  }
}

export async function voiceShowCommand(id: string): Promise<void> {
  const config = await loadConfig();
  // Same parallel rationale as `model list`: the second call gates nothing.
  const [voice, samples] = await Promise.all([getJson<Voice>(config, `/voices/${encodeURIComponent(id)}`), getJson<VoiceSample[]>(config, `/voices/${encodeURIComponent(id)}/samples`)]);

  const line = (label: string, value: string) => `${color.bold(`${label}:`.padEnd(14))}${value}\n`;

  process.stdout.write(line('ID', voice.id));
  process.stdout.write(line('Name', voice.name || color.dim('(unnamed)')));
  if (voice.description) {
    process.stdout.write(line('Description', voice.description));
  }
  process.stdout.write(line('Language', voice.language || color.dim('(none)')));
  process.stdout.write(line('Model', voice.model || color.dim('(none)')));
  process.stdout.write(line('Visibility', voice.public ? color.green('public') : color.dim('private')));
  if (voice.tags && voice.tags.length > 0) {
    process.stdout.write(line('Tags', voice.tags.join(', ')));
  }
  process.stdout.write(line('Created', new Date(voice.created).toLocaleString()));
  process.stdout.write(line('Samples', String(samples.length)));

  if (samples.length > 0) {
    process.stdout.write('\n');
    for (const s of samples) {
      const enabled = s.enabled ? color.green('●') : color.dim('○');
      const duration = s.duration != null ? `${s.duration.toFixed(1)}s` : color.dim('?');
      const transcript = s.transcript ? s.transcript.slice(0, 60) + (s.transcript.length > 60 ? '…' : '') : color.dim('(no transcript)');
      process.stdout.write(`  ${enabled} ${color.dim(`#${s.order ?? '?'}`)} ${duration.padStart(6)}  ${transcript}\n`);
    }
  }
}
