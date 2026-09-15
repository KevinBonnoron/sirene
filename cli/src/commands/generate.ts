import { writeFile } from 'node:fs/promises';
import { buildWav } from '@sirene/shared';
import { postForBytes } from '../api';
import { loadConfig } from '../config';

interface Options {
  voice: string;
  text: string;
  output?: string;
  speed?: number;
  stream?: boolean;
}

export async function generateCommand(options: Options): Promise<void> {
  const config = await loadConfig();
  const path = options.stream ? '/generate/stream' : '/generate';
  const body: Record<string, unknown> = { voice: options.voice, input: options.text };
  if (options.speed !== undefined) {
    body.speed = options.speed;
  }

  const result = await postForBytes(config, path, body);

  let audio: Uint8Array;
  if (options.stream) {
    if (!result.sampleRate) {
      throw new Error('Server did not return sample rate for streaming response');
    }
    const wav = buildWav([result.bytes], result.bytes.length, result.sampleRate);
    audio = new Uint8Array(wav);
  } else {
    audio = result.bytes;
  }

  if (options.output === '-') {
    process.stdout.write(audio);
    return;
  }
  if (options.output) {
    await writeFile(options.output, audio);
    process.stdout.write(`Wrote ${audio.length} bytes to ${options.output}\n`);
    return;
  }
  if (!process.stdout.isTTY) {
    process.stdout.write(audio);
    return;
  }
  const fallback = `sirene-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.wav`;
  await writeFile(fallback, audio);
  process.stdout.write(`Wrote ${audio.length} bytes to ./${fallback}\n`);
}
