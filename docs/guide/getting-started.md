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

See the [Docker guide](./docker.md) for more options.

## First Launch

1. Open the app (or navigate to `http://localhost:5173` for Docker)
2. Go to the **Models** page and install the model of your choice (e.g. Kokoro v1.0)
3. You're ready to generate speech
