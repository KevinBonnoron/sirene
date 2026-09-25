package launcher

import (
	"context"
	"os/exec"
	"runtime"
	"time"
)

// Long enough for a driver that is present, short enough not to stall the launch when one
// is installed but wedged.
const probeTimeout = 3 * time.Second

// The worker installs torch on first use, so the accelerator cannot be read from a Python
// import at launch: it has to be read from the machine. A wrong guess is not fatal — the
// worker probes the device again before loading a model and falls back to the CPU.
func DetectDevice(ctx context.Context, lookPath func(string) (string, error), run func(context.Context, string) error) string {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		return "mps"
	}
	if _, err := lookPath("nvidia-smi"); err != nil {
		return "cpu"
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	// Being on PATH proves a package was installed, not that a card answers.
	if err := run(ctx, "nvidia-smi"); err != nil {
		return "cpu"
	}
	return "cuda"
}

func detectDevice(ctx context.Context) string {
	return DetectDevice(ctx, exec.LookPath, func(ctx context.Context, name string) error {
		return exec.CommandContext(ctx, name, "-L").Run()
	})
}
