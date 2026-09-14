package launcher

import (
	"context"
	"os"
	"testing"
	"time"
)

// Downloads a real Python runtime and installs the inference service; only
// runs when SIRENE_E2E=1 because it needs the network and a few minutes.
func TestBootstrapEndToEnd(t *testing.T) {
	if os.Getenv("SIRENE_E2E") != "1" {
		t.Skip("set SIRENE_E2E=1 to run")
	}
	t.Setenv("SIRENE_HOME", t.TempDir())
	paths, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	port, err := ReservePort()
	if err != nil {
		t.Fatal(err)
	}
	proc, err := Bootstrap(ctx, paths, port, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	proc.Stop()
	if _, err := os.Stat(paths.PythonBin()); err != nil {
		t.Fatal("python binary missing after bootstrap")
	}
}
