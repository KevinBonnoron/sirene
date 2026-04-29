# Getting Started

## Desktop App

Download the latest release for your platform from the [releases page](https://github.com/KevinBonnoron/sirene/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `desktop-macos-arm64.zip` |
| Linux (x64) | `desktop-linux-x64.zip` |
| Windows (x64) | `desktop-windows-x64.zip` |

On first launch, Sirene will set up its inference environment automatically.

## Docker

The quickest way to run Sirene as a server:

```bash
curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | bash
```

> **Supply-chain note.** The bootstrap script is fetched from `main`. For production deployments review the [latest release](https://github.com/KevinBonnoron/sirene/releases) and replace `main` with the corresponding tag once a release that supports your installation mode is published.

See the [Docker guide](./docker.md) for more options.

## First Launch

1. Open the app (or navigate to `http://localhost:5173` for Docker)
2. Go to the **Models** page and install the model of your choice (e.g. Kokoro v1.0)
3. You're ready to generate speech

## Adding more inference workers

If you have a separate Linux machine with a GPU, you can add it as an inference worker:

1. On the worker machine, run:

   ```bash
   curl -sSL https://raw.githubusercontent.com/KevinBonnoron/sirene/main/install.sh | INSTALL_MODE=worker bash
   ```

2. The script prints a **URL** and an **auth token** when it finishes
3. In Sirene → **Settings → Inference servers → Add server**, paste both, give it a name, save

> **Keep the auth token secret.** It grants full control of your worker's inference. Do not paste it into chats, screenshots, or logs, and rotate it if you suspect it has leaked.
>
> **Rotating a token.** Delete `auth_token` on the worker, rerun the worker installer to mint a new value, then update the matching server entry in Sirene → **Settings → Inference servers** with the new token. Until the server entry is updated, every request to that worker will return 401.

See the [Docker guide](./docker.md#worker-servers-script-install) for details.
