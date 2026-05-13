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
    // Streaming endpoint returns raw PCM int16 mono. Wrap with a WAV header so
    // the file plays in standard players. Header carries the sample rate
    // returned by the server.
    if (!result.sampleRate) {
      throw new Error('Server did not return sample rate for streaming response');
    }
    const wav = buildWav([result.bytes], result.bytes.length, result.sampleRate);
    audio = new Uint8Array(wav);
  } else {
    audio = result.bytes;
  }

  // Three output modes:
  //  - explicit `--output path`  → that file
  //  - explicit `--output -`     → stdout (binary), regardless of TTY
  //  - no flag in a pipe         → stdout
  //  - no flag in a TTY          → auto-named file in CWD, since blasting raw
  //                                bytes at the terminal is never what the user
  //                                wants and a "you forgot --output" error is
  //                                unfriendly.
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
