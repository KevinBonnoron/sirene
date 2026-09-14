package launcher

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// inference_src is filled from ../../../inference by `task desktop:sync:inference`.
//
//go:embed all:inference_src
var inferenceSrc embed.FS

const depsMarker = ".deps-installed"

// SyncSource writes the embedded inference service to p.Inference and reports
// the hash of its dependency manifest, so a changed pyproject reinstalls deps.
func SyncSource(p Paths) (string, error) {
	root, err := fs.Sub(inferenceSrc, "inference_src")
	if err != nil {
		return "", err
	}
	if _, err := fs.Stat(root, "pyproject.toml"); err != nil {
		return "", fmt.Errorf("inference source not embedded: run `task desktop:sync:inference` before building")
	}
	if err := os.MkdirAll(p.Inference, 0o700); err != nil {
		return "", err
	}
	// Replace the managed tree wholesale: an update that turns a file into a
	// directory (or back) would otherwise fail every sync from then on.
	if err := os.RemoveAll(filepath.Join(p.Inference, "src")); err != nil {
		return "", err
	}
	hasher := sha256.New()
	err = fs.WalkDir(root, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(p.Inference, filepath.FromSlash(path))
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := fs.ReadFile(root, path)
		if err != nil {
			return err
		}
		if path == "pyproject.toml" {
			hasher.Write(data)
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// EnsureDeps installs the inference service and its base dependencies into
// the standalone Python; heavy backends stay lazy (installed by the worker
// into p.Packages on first use). The marker lives with the interpreter so
// a reinstalled Python starts without it.
func EnsureDeps(ctx context.Context, p Paths, manifestHash string, logf func(string, ...any)) error {
	marker := filepath.Join(p.Python, depsMarker)
	if current, err := os.ReadFile(marker); err == nil && string(current) == manifestHash {
		return nil
	}
	py := p.PythonBin()
	if err := runLogged(ctx, logf, p.Inference, py, "-m", "ensurepip", "--upgrade"); err != nil {
		logf("ensurepip failed (pip may already be present): %v", err)
	}
	logf("installing inference dependencies (first run, this takes a few minutes)")
	if err := runLogged(ctx, logf, p.Inference, py, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location", "--upgrade", "pip"); err != nil {
		return err
	}
	if err := runLogged(ctx, logf, p.Inference, py, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location", "."); err != nil {
		return err
	}
	return os.WriteFile(marker, []byte(manifestHash), 0o644)
}

func runLogged(ctx context.Context, logf func(string, ...any), dir string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = logWriter{logf}
	cmd.Stderr = logWriter{logf}
	return cmd.Run()
}

type logWriter struct {
	logf func(string, ...any)
}

func (w logWriter) Write(b []byte) (int, error) {
	w.logf("%s", string(b))
	return len(b), nil
}

// Process is a running uvicorn worker.
type Process struct {
	cmd  *exec.Cmd
	done chan struct{}
	mu   sync.Mutex
	err  error
}

func (p *Process) Stop() {
	if p == nil || p.cmd.Process == nil {
		return
	}
	terminate(p.cmd)
	select {
	case <-p.done:
	case <-time.After(5 * time.Second):
		_ = p.cmd.Process.Kill()
		<-p.done
	}
}

func (p *Process) Wait() error {
	<-p.done
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.err
}

// Reservation holds a loopback port open until the worker is about to bind
// it, so the port announced to the server cannot be taken by another local
// process while Python is being installed.
type Reservation struct {
	listener net.Listener
}

func ReservePort() (*Reservation, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	return &Reservation{listener: l}, nil
}

func (r *Reservation) Port() int {
	return r.listener.Addr().(*net.TCPAddr).Port
}

func (r *Reservation) Release() {
	if r.listener != nil {
		r.listener.Close()
		r.listener = nil
	}
}

func Start(ctx context.Context, p Paths, port *Reservation, logf func(string, ...any)) (*Process, error) {
	device := os.Getenv("SIRENE_INFERENCE_DEVICE")
	if device == "" {
		device = "cpu"
	}
	cmd := exec.Command(p.PythonBin(), "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", strconv.Itoa(port.Port()))
	cmd.Dir = p.Inference
	cmd.Env = append(os.Environ(),
		"INFERENCE_MODELS_PATH="+p.Models,
		"INFERENCE_CACHE_DIR="+filepath.Join(p.Cache, "prompts"),
		"INFERENCE_DEVICE="+device,
		"PACKAGES_DIR="+p.Packages,
		"INFERENCE_ALLOW_NO_AUTH=true",
		"PYTHONUNBUFFERED=1",
	)
	cmd.Stdout = logWriter{logf}
	cmd.Stderr = logWriter{logf}
	setProcessGroup(cmd)
	port.Release()
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	proc := &Process{cmd: cmd, done: make(chan struct{})}
	go func() {
		err := cmd.Wait()
		proc.mu.Lock()
		proc.err = err
		proc.mu.Unlock()
		close(proc.done)
	}()
	go func() {
		select {
		case <-ctx.Done():
			proc.Stop()
		case <-proc.done:
		}
	}()
	return proc, nil
}

// Bootstrap prepares Python and the inference service, then starts it and
// waits for its health endpoint. It is meant to run in the background while
// the UI is already usable; the "Local" inference server simply reports
// offline until it answers.
func Bootstrap(ctx context.Context, p Paths, port *Reservation, logf func(string, ...any)) (*Process, error) {
	// Start releases it right before binding; this covers every earlier failure.
	defer port.Release()
	if err := EnsurePython(ctx, p, logf); err != nil {
		return nil, err
	}
	hash, err := SyncSource(p)
	if err != nil {
		return nil, err
	}
	if err := EnsureDeps(ctx, p, hash, logf); err != nil {
		return nil, err
	}
	number := port.Port()
	proc, err := Start(ctx, p, port, logf)
	if err != nil {
		return nil, err
	}
	logf("inference worker starting on port %d", number)
	healthCtx, stopHealth := context.WithCancel(ctx)
	defer stopHealth()
	healthy := make(chan error, 1)
	go func() {
		healthy <- WaitHealthy(healthCtx, fmt.Sprintf("http://127.0.0.1:%d/health", number), 5*time.Minute)
	}()
	select {
	case err := <-healthy:
		if err != nil {
			proc.Stop()
			return nil, err
		}
	case <-proc.done:
		if err := proc.Wait(); err != nil {
			return nil, fmt.Errorf("inference worker exited before becoming healthy: %w", err)
		}
		return nil, errors.New("inference worker exited before becoming healthy")
	}
	logf("inference worker ready")
	return proc, nil
}

func WaitHealthy(ctx context.Context, url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		res, err := client.Get(url)
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("%s did not become healthy within %s", url, timeout)
}
