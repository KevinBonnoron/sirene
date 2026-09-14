# Getting Started

## Desktop App

Download the latest release for your platform from the [releases page](https://github.com/KevinBonnoron/sirene/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `sirene-desktop-macos-arm64.zip` |
| Linux (x64) | `sirene-desktop-linux-amd64.tar.gz` |
| Windows (x64) | `sirene-desktop-windows-amd64.zip` |

The download is a few tens of megabytes. On first launch, Sirene downloads a standalone Python and the inference service into `~/.sirene` (a few hundred megabytes); the `Local` inference server shows as offline in **Settings → Inference servers** until that finishes. TTS backends themselves are installed on demand when you install a model. Logs are in `~/.sirene/logs/desktop.log`.

## Docker

The quickest way to run Sirene as a server:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
```

> **Supply-chain note.** The bootstrap script is fetched from `main`. For production deployments review the [latest release](https://github.com/KevinBonnoron/sirene/releases) and replace `main` with the corresponding tag once a release that supports your installation mode is published.

See the [Docker guide](./docker.md) for more options.

## First Launch

1. Open the app (`http://localhost` for Docker)
2. Create the administrator account in the setup wizard
3. Go to the **Models** page and install the model of your choice (e.g. Kokoro v1.0)
4. You're ready to generate speech

## Adding more inference servers

If you have a separate Linux machine with a GPU, you can add it as an inference server:

1. On that machine, run:

   ```bash
   curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | INSTALL_MODE=inference bash
   ```

2. The script prints a **URL** and an **auth token** when it finishes
3. In Sirene → **Settings → Inference servers → Add server**, paste both, give it a name, save

> **Keep the auth token secret.** It grants full control of the inference server. Do not paste it into chats, screenshots, or logs, and rotate it if you suspect it has leaked.
>
> **Rotating a token.** Delete `auth_token` on the inference host, rerun the installer to mint a new value, then update the matching entry in Sirene → **Settings → Inference servers** with the new token. Until the entry is updated, every request to that inference server will return 401.

See the [Docker guide](./docker.md#standalone-inference-script-install) for details.
