#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { ApiError } from './api';
import { configGetCommand, configSetCommand } from './commands/config';
import { doctorCommand } from './commands/doctor';
import { generateCommand } from './commands/generate';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { modelListCommand } from './commands/model';
import { modelPullCommand } from './commands/model-pull';
import { modelRmCommand } from './commands/model-rm';
import { authStatusCommand } from './commands/status';
import { voiceListCommand, voiceShowCommand } from './commands/voice';

const VERSION = '0.1.0';

function parseSpeed(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`--speed must be a number, got "${value}"`);
  }
  // Mirror the server-side bound: anything outside [0.1, 5] is rejected here
  // so the CLI fails fast with a clear message instead of bouncing off a 400.
  if (n < 0.1 || n > 5) {
    throw new Error(`--speed must be between 0.1 and 5, got "${value}"`);
  }

  return n;
}

/** Enforce Unix-style ordering: every flag must appear *before* the positional
 *  arguments. Citty's parser is lenient and accepts both orders, but mixing
 *  them ("text" before --flags) is ambiguous to read and easy to fat-finger,
 *  so we reject it explicitly.
 *
 *  `booleanFlags` lists the long names of flags that take no value, so we know
 *  not to consume the next token as their value while scanning. */
function enforceFlagsBeforePositional(rawArgs: string[], booleanFlags: Set<string>): void {
  let positionalSeen = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith('-')) {
      if (positionalSeen) {
        throw new Error(`Flags must come before positional arguments. Found '${arg}' after a positional. Try: --voice <id> "<text>"`);
      }
      const eqIdx = arg.indexOf('=');
      const flagName = (eqIdx === -1 ? arg : arg.slice(0, eqIdx)).replace(/^-+/, '');
      const hasInlineValue = eqIdx !== -1;
      const isBoolean = booleanFlags.has(flagName);
      if (!isBoolean && !hasInlineValue) {
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          i++;
        }
      }
    } else {
      positionalSeen = true;
    }
  }
}

const auth = defineCommand({
  meta: { name: 'auth', description: 'Authenticate with a Sirene server' },
  subCommands: {
    login: defineCommand({
      meta: { name: 'login', description: 'Sign in via the browser (device-code flow)' },
      args: {
        url: { type: 'string', description: 'Server URL (defaults to the previously saved value)' },
        key: { type: 'string', description: 'Skip the browser flow and save this API key directly (headless / CI; use `read -s K && --key "$K"` to keep it out of shell history)' },
        scopes: { type: 'string', description: 'Comma-separated capabilities to restrict the key to (e.g. "generate,voices:read"). Omit for full access.' },
      },
      async run({ args }) {
        const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
        await loginCommand({ url: str(args.url), key: str(args.key), scopes: str(args.scopes) });
      },
    }),
    logout: defineCommand({
      meta: { name: 'logout', description: 'Remove the stored API key' },
      async run() {
        await logoutCommand();
      },
    }),
    status: defineCommand({
      meta: { name: 'status', description: 'Show the current authentication state' },
      async run() {
        await authStatusCommand();
      },
    }),
  },
});

const generate = defineCommand({
  meta: { name: 'generate', description: 'Generate speech from text' },
  args: {
    text: { type: 'positional', description: 'Text to synthesize (quote multi-word input)', required: true },
    voice: { type: 'string', description: 'Voice ID', required: true, alias: 'v' },
    output: { type: 'string', description: 'Output file path, or "-" to write to stdout', alias: 'o' },
    speed: { type: 'string', description: 'Playback speed multiplier (0.1 - 5)' },
    stream: { type: 'boolean', description: 'Use the streaming endpoint (raw PCM wrapped as WAV)' },
  },
  async run({ args, rawArgs }) {
    enforceFlagsBeforePositional(rawArgs, new Set(['stream']));
    await generateCommand({
      text: args.text,
      voice: args.voice,
      output: args.output,
      speed: parseSpeed(args.speed),
      stream: args.stream === true,
    });
  },
});

const voice = defineCommand({
  meta: { name: 'voice', description: 'Manage voices' },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'List available voices' },
      async run() {
        await voiceListCommand();
      },
    }),
    show: defineCommand({
      meta: { name: 'show', description: 'Show details about a voice (info + samples)' },
      args: {
        id: { type: 'positional', description: 'Voice ID', required: true },
      },
      async run({ args }) {
        await voiceShowCommand(String(args.id));
      },
    }),
  },
});

const model = defineCommand({
  meta: { name: 'model', description: 'Inspect and install models' },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'List the model catalog with install status' },
      async run() {
        await modelListCommand();
      },
    }),
    pull: defineCommand({
      meta: { name: 'pull', description: 'Download a model (streams progress)' },
      args: {
        id: { type: 'positional', description: 'Catalog model ID', required: true },
        server: { type: 'string', description: 'Target a specific inference server (repeat for several). Default: every online worker.' },
      },
      async run({ args }) {
        const id = String(args.id);
        const raw = args.server;
        const serverIds = typeof raw === 'string' && raw.length > 0 ? [raw] : Array.isArray(raw) ? raw : undefined;
        await modelPullCommand(id, { serverIds });
      },
    }),
    rm: defineCommand({
      meta: { name: 'rm', description: 'Remove an installed model (destructive; prompts for confirmation)' },
      args: {
        id: { type: 'positional', description: 'Model ID to remove', required: true },
        server: { type: 'string', description: 'Remove only from this server. Default: every server it is installed on.' },
        force: { type: 'boolean', description: 'Skip the confirmation prompt (required for non-interactive use)' },
      },
      async run({ args }) {
        const id = String(args.id);
        const serverId = typeof args.server === 'string' && args.server.length > 0 ? args.server : undefined;
        await modelRmCommand(id, { serverId, force: args.force === true });
      },
    }),
  },
});

const doctor = defineCommand({
  meta: { name: 'doctor', description: 'Run end-to-end health checks (server, auth, workers, models)' },
  async run() {
    await doctorCommand();
  },
});

const config = defineCommand({
  meta: { name: 'config', description: 'Read and update CLI configuration' },
  subCommands: {
    get: defineCommand({
      meta: { name: 'get', description: 'Print a config value (or all values if no key is given)' },
      args: {
        key: { type: 'positional', description: 'Config key (url | apiKey)', required: false },
      },
      async run({ args }) {
        await configGetCommand(typeof args.key === 'string' ? args.key : undefined);
      },
    }),
    set: defineCommand({
      meta: { name: 'set', description: 'Update a config value' },
      args: {
        key: { type: 'positional', description: 'Config key (url | apiKey)', required: true },
        value: { type: 'positional', description: 'New value', required: true },
      },
      async run({ args }) {
        await configSetCommand(String(args.key), String(args.value));
      },
    }),
  },
});

const main = defineCommand({
  meta: {
    name: 'sirene',
    version: VERSION,
    description: 'Command-line client for Sirene TTS',
  },
  subCommands: { auth, doctor, generate, model, voice, config },
});

/** Walk the command tree following positional args so we can show the most
 *  relevant usage on error. `sirene voice <bad>` should display the voice
 *  usage, not the top-level one. */
type CmdLike = { subCommands?: Record<string, CmdLike> };
function findCommand(root: CmdLike, rawArgs: string[]): CmdLike {
  let cmd: CmdLike = root;
  for (const arg of rawArgs) {
    if (arg.startsWith('-')) {
      continue;
    }

    const subs = cmd.subCommands;
    const next = subs?.[arg];
    if (!next) {
      break;
    }

    cmd = next;
  }
  return cmd;
}

// We drive citty via `runCommand` rather than `runMain` so we own the error
// channel. `runMain` calls `consola.error(message + stack)` then `process.exit(1)`
// which produces a noisy two-paragraph trace on every API failure - useless for
// CLI users who just want to see "Invalid API key" once.
const cliRawArgs = process.argv.slice(2);

// Citty 0.1.x only auto-handles `--help` / `-h` on commands that have
// subCommands; leaf commands fall through and execute their `run` handler
// instead of printing usage. We intercept here so `sirene auth login --help`
// behaves like every other --help in the CLI.
if (cliRawArgs.some((a) => a === '--help' || a === '-h')) {
  const cmd = findCommand(main as CmdLike, cliRawArgs);
  await showUsage(cmd as Parameters<typeof showUsage>[0]).catch(() => undefined);
  process.exit(0);
}

runCommand(main, { rawArgs: cliRawArgs })
  .then(() => process.exit(0))
  .catch(async (err) => {
    if (err instanceof ApiError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(err.status >= 400 && err.status < 500 ? 2 : 1);
    }

    const message = err instanceof Error ? err.message : String(err);
    // Citty raises argument / dispatch errors ("Unknown command `x`",
    // "No command specified.", "Missing required positional argument: TEXT",
    // "Missing required argument: --voice") before any `run` handler can
    // intervene. Print the cause AND the deepest matched command's usage so
    // the user can recover without typing `--help` separately.
    const rawArgs = process.argv.slice(2);
    const isUnknown = /^unknown command/i.test(message);
    const isMissingCommand = /^no command specified/i.test(message);
    const isMissingArg = /^missing required/i.test(message);
    if (isUnknown || isMissingCommand || isMissingArg) {
      const cmd = findCommand(main as CmdLike, rawArgs);
      if (isUnknown || isMissingArg) {
        process.stderr.write(`error: ${message}\n\n`);
      }
      await showUsage(cmd as Parameters<typeof showUsage>[0]);
      process.exit(isMissingCommand ? 0 : 2);
    }
    process.stderr.write(`error: ${message}\n`);
    process.exit(1);
  });
