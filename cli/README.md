# `sirene` CLI

Command-line client for [Sirene](https://github.com/KevinBonnoron/sirene). Talks to a running Sirene server over HTTP using an API key.

## Install

### One-liner installer (recommended)

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/scripts/install.sh | INSTALL_MODE=cli bash
```

Auto-detects platform, downloads the matching binary from the latest release, installs to `~/.local/bin` (or `/usr/local/bin` if not writable) and verifies it's on `$PATH`.

### Manual download

If you'd rather pick the binary by hand:

```bash
# Linux x64
curl -L -o sirene https://github.com/KevinBonnoron/sirene/releases/latest/download/sirene-linux-x64
chmod +x sirene && mv sirene ~/.local/bin/

# macOS arm64
curl -L -o sirene https://github.com/KevinBonnoron/sirene/releases/latest/download/sirene-darwin-arm64
chmod +x sirene && mv sirene ~/.local/bin/

# Windows: download sirene-windows-x64.exe and add it to your PATH
```

### From source

```bash
bun install
bun run --cwd cli build
# Binary is in cli/dist/sirene
```

Cross-platform binaries are produced by the `cli-release` GitHub Actions workflow on `cli-v*` tags.

## First run

1. Open the Sirene web UI, go to **Settings → API Keys**, and create a key. Copy it (it's shown only once).
2. Authenticate the CLI:

   ```bash
   sirene auth login --url https://sirene.example.com
   # paste the key when prompted
   ```

3. Generate audio:

   ```bash
   sirene voice list
   sirene generate "Hello world" --voice <voice-id> --output hello.wav
   ```

## Configuration

Config file: `~/.config/sirene/config.json` (or `$XDG_CONFIG_HOME/sirene/config.json`).
Environment variables override the file:

- `SIRENE_URL` - server base URL, e.g. `https://sirene.example.com` (no `/api` suffix, the CLI appends it)
- `SIRENE_API_KEY` - API key (same value as the one created in the UI)

## Commands

| Command | Description |
|---|---|
| `sirene auth login [--url <url>] [--key <key>] [--scopes a,b,...]` | Save credentials. Opens a browser for the device-code flow, or accepts a pre-existing key via `--key`. |
| `sirene auth logout` | Remove the stored API key. |
| `sirene auth status` | Show current authentication state. |
| `sirene voice list` | List voices available to the user. |
| `sirene voice show <id>` | Show one voice and its samples. |
| `sirene generate <text> --voice <id> [--output file.wav] [--speed n] [--stream]` | Generate audio. Streaming returns raw PCM wrapped as WAV. Use `--output -` or pipe stdout for binary output. |
| `sirene model list` | List installed and available models. |
| `sirene model pull <id> [--server-ids ...]` | Pull a model on one or more inference servers. |
| `sirene model rm <id> [--server-id <id>] [--force]` | Remove a model. |
| `sirene config get [<key>]` | Show current configuration. |
| `sirene config set <key> <value>` | Update `url` or `apiKey`. |
| `sirene doctor` | Diagnose CLI + server connectivity. |
