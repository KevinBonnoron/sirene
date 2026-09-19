import type { Job } from '@sirene/shared';
import { ApiError, postJson } from '../api';
import { type CliConfig, loadConfig } from '../config';
import { color } from '../utils';

interface PullResponse {
  jobIds: string[];
}

interface Options {
  serverIds?: string[];
}

const BAR_WIDTH = 24;

async function* streamJobEvents(config: CliConfig): AsyncGenerator<{ event: string; data: unknown }> {
  if (!config.url || !config.apiKey) {
    throw new ApiError(0, 'Not logged in');
  }
  const url = `${config.url.replace(/\/+$/, '')}/api/events`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'text/event-stream',
    },
  });
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).trim().slice(0, 300);
    throw new ApiError(response.status, `Failed to open the event stream: ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  const dataLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // The server may close without a trailing blank line; flush the buffered event.
      if (dataLines.length > 0) {
        try {
          yield { event, data: JSON.parse(dataLines.join('\n')) };
        } catch {}
      }
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        if (dataLines.length > 0) {
          try {
            yield { event, data: JSON.parse(dataLines.join('\n')) };
          } catch {}
          dataLines.length = 0;
          event = 'message';
        }
        continue;
      }
      if (line.startsWith(':')) {
        continue;
      }
      const colonIdx = line.indexOf(':');
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
      const valueStr = colonIdx === -1 ? '' : line[colonIdx + 1] === ' ' ? line.slice(colonIdx + 2) : line.slice(colonIdx + 1);
      if (field === 'data') {
        dataLines.push(valueStr);
      } else if (field === 'event') {
        event = valueStr;
      }
    }
  }
}

function renderBar(job: Job, labelWidth: number): string {
  const progress = Math.max(0, Math.min(100, job.progress));
  const filled = Math.round((progress / 100) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pct = `${String(progress).padStart(3)}%`;

  let suffix: string;
  if (job.status === 'completed') {
    suffix = color.green('done');
  } else if (job.status === 'failed') {
    suffix = color.red(`failed${job.error ? `: ${job.error}` : ''}`);
  } else {
    suffix = pct;
  }

  const label = job.label.padEnd(labelWidth);
  const coloredBar = job.status === 'failed' ? color.red(bar) : job.status === 'completed' ? color.green(bar) : color.cyan(bar);
  return `${label}  ${coloredBar}  ${suffix}`;
}

class MultiBarRenderer {
  private linesDrawn = 0;
  private readonly isTty = process.stdout.isTTY === true;

  public render(jobs: Job[]): void {
    if (jobs.length === 0) {
      return;
    }
    const labelWidth = Math.max(0, ...jobs.map((j) => j.label.length));
    const lines = jobs.map((j) => renderBar(j, labelWidth));

    if (!this.isTty) {
      for (const line of lines) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write('\n');
      return;
    }

    if (this.linesDrawn > 0) {
      process.stdout.write(`\x1b[${this.linesDrawn}A`);
    }
    for (const line of lines) {
      process.stdout.write(`\x1b[2K\r${line}\n`);
    }
    this.linesDrawn = lines.length;
  }

  public finish(): void {
    if (!this.isTty) {
      return;
    }
    this.linesDrawn = 0;
  }
}

export async function modelPullCommand(modelId: string, options: Options): Promise<void> {
  const config = await loadConfig();

  const response = await postJson<PullResponse>(config, `/models/${encodeURIComponent(modelId)}/pull`, { serverIds: options.serverIds });
  if (response.jobIds.length === 0) {
    process.stdout.write('Nothing to pull.\n');
    return;
  }

  const tracked = new Set(response.jobIds);
  process.stdout.write(`Pulling ${color.bold(modelId)} (${response.jobIds.length} job${response.jobIds.length > 1 ? 's' : ''})…\n`);

  const state = new Map<string, Job>();
  const renderer = new MultiBarRenderer();

  const renderJobs = (): Job[] => response.jobIds.map((id) => state.get(id)).filter((j): j is Job => j !== undefined);

  let allDone = false;
  for await (const { event, data } of streamJobEvents(config)) {
    if (event === 'jobs') {
      for (const job of data as Job[]) {
        if (tracked.has(job.id)) {
          state.set(job.id, job);
        }
      }
    } else if (event === 'job') {
      const job = data as Job;
      if (tracked.has(job.id)) {
        state.set(job.id, job);
      }
    } else if (event === 'job.removed') {
      const { id } = data as { id: string };
      tracked.delete(id);
    }

    renderer.render(renderJobs());

    allDone = response.jobIds.every((id) => {
      const job = state.get(id);
      return job && (job.status === 'completed' || job.status === 'failed');
    });
    if (allDone) {
      break;
    }
  }

  renderer.finish();

  if (!allDone) {
    process.stderr.write(`${color.red('✗')} Job stream closed before all pulls completed; check the server.\n`);
    process.exit(1);
  }

  const failed = [...state.values()].filter((j) => j.status === 'failed');
  if (failed.length > 0) {
    process.exit(1);
  }
  process.stdout.write(`${color.green('✓')} Done.\n`);
}
