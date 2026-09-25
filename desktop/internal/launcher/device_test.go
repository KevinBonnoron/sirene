package launcher

import (
	"context"
	"errors"
	"runtime"
	"testing"
)

func found(string) (string, error)          { return "/usr/bin/nvidia-smi", nil }
func missing(string) (string, error)        { return "", errors.New("not found") }
func answers(context.Context, string) error { return nil }
func silent(context.Context, string) error  { return errors.New("no devices were found") }

func TestAMachineWithoutADriverGetsTheCPU(t *testing.T) {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		t.Skip("Apple silicon always reports Metal")
	}
	if got := DetectDevice(context.Background(), missing, answers); got != "cpu" {
		t.Fatalf("expected cpu, got %q", got)
	}
}

func TestADriverThatAnswersGetsCuda(t *testing.T) {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		t.Skip("Apple silicon always reports Metal")
	}
	if got := DetectDevice(context.Background(), found, answers); got != "cuda" {
		t.Fatalf("expected cuda, got %q", got)
	}
}

// A driver package can be installed on a machine with no card in it.
func TestADriverOnDiskThatListsNothingGetsTheCPU(t *testing.T) {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		t.Skip("Apple silicon always reports Metal")
	}
	if got := DetectDevice(context.Background(), found, silent); got != "cpu" {
		t.Fatalf("expected cpu, got %q", got)
	}
}

func TestAppleSiliconGetsMetalWithoutProbing(t *testing.T) {
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" {
		t.Skip("not Apple silicon")
	}
	probed := false
	got := DetectDevice(context.Background(), func(string) (string, error) {
		probed = true
		return "", errors.New("not found")
	}, answers)
	if got != "mps" || probed {
		t.Fatalf("expected mps without probing, got %q (probed=%v)", got, probed)
	}
}

// Shutdown cancels the launch context; a wedged driver must not outlive it.
func TestACancelledLaunchStopsTheProbe(t *testing.T) {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		t.Skip("Apple silicon does not probe")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var sawCancelled bool
	got := DetectDevice(ctx, found, func(probe context.Context, _ string) error {
		sawCancelled = probe.Err() != nil
		return probe.Err()
	})
	if !sawCancelled || got != "cpu" {
		t.Fatalf("expected the probe to see the cancellation and fall back, got %q (cancelled=%v)", got, sawCancelled)
	}
}
