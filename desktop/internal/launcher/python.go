package launcher

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Pinned python-build-standalone release; bump both together.
const (
	pythonVersion = "3.11.11"
	pythonTag     = "20250317"
)

// From the release's SHA256SUMS, keyed by archive file name.
var pythonArchiveSHA256 = map[string]string{
	"cpython-3.11.11+20250317-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz":  "b0736ee681f88bf487687b5248ca9fb15fe5f7d584f7d1ed2bc9c9578300b097",
	"cpython-3.11.11+20250317-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz": "3a81577e9b1cddf3d91796d7c22657aadccada8f78fb9e3e64ce8d2bbb95c73a",
	"cpython-3.11.11+20250317-x86_64-apple-darwin-install_only_stripped.tar.gz":       "7b7b393c53c8371509087a60d858ee2567bc439bda13c81564647f79f3905224",
	"cpython-3.11.11+20250317-aarch64-apple-darwin-install_only_stripped.tar.gz":      "f8df308b918750a466bf585b14befd4349e69d5135b83090254e6f2ee65b1bf1",
	"cpython-3.11.11+20250317-x86_64-pc-windows-msvc-install_only_stripped.tar.gz":    "4a9409fedb95312eabbe2285c836f688742a0ea4e6ccab7f0d68cb0e0cbb2fe4",
}

func pythonArchive() (file string, url string, sha string, err error) {
	var target string
	switch runtime.GOOS {
	case "linux":
		target = "unknown-linux-gnu"
	case "darwin":
		target = "apple-darwin"
	case "windows":
		target = "pc-windows-msvc"
	default:
		return "", "", "", fmt.Errorf("unsupported OS %s", runtime.GOOS)
	}
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "aarch64"
	default:
		return "", "", "", fmt.Errorf("unsupported architecture %s", runtime.GOARCH)
	}
	file = fmt.Sprintf("cpython-%s+%s-%s-%s-install_only_stripped.tar.gz", pythonVersion, pythonTag, arch, target)
	sha, ok := pythonArchiveSHA256[file]
	if !ok {
		return "", "", "", fmt.Errorf("no pinned checksum for %s", file)
	}
	return file, "https://github.com/astral-sh/python-build-standalone/releases/download/" + pythonTag + "/" + file, sha, nil
}

// EnsurePython downloads a standalone CPython into p.Python on first run.
// The archive is verified against its pinned checksum before extraction, then
// its single top-level "python/" directory is renamed into place so a failed
// download never leaves a half-installed runtime.
const pythonVersionMarker = ".sirene-python-version"

func pythonRelease() string {
	return pythonVersion + "+" + pythonTag
}

func EnsurePython(ctx context.Context, p Paths, logf func(string, ...any)) error {
	marker, _ := os.ReadFile(filepath.Join(p.Python, pythonVersionMarker))
	if _, err := os.Stat(p.PythonBin()); err == nil && string(marker) == pythonRelease() {
		return nil
	}
	file, url, want, err := pythonArchive()
	if err != nil {
		return err
	}
	logf("downloading Python %s from %s", pythonVersion, url)
	archive, err := downloadVerified(ctx, url, want, filepath.Join(p.Root, file+".part"))
	if err != nil {
		return err
	}
	defer os.Remove(archive)
	staging := p.Python + ".staging"
	os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o700); err != nil {
		return err
	}
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	err = extractTarGz(f, staging)
	f.Close()
	if err != nil {
		os.RemoveAll(staging)
		return fmt.Errorf("extract python: %w", err)
	}
	extracted := filepath.Join(staging, "python")
	if _, err := os.Stat(extracted); err != nil {
		os.RemoveAll(staging)
		return fmt.Errorf("unexpected archive layout: %w", err)
	}
	if err := os.WriteFile(filepath.Join(extracted, pythonVersionMarker), []byte(pythonRelease()), 0o600); err != nil {
		return err
	}
	os.RemoveAll(p.Python)
	if err := os.Rename(extracted, p.Python); err != nil {
		return err
	}
	os.RemoveAll(staging)
	logf("Python installed at %s", p.Python)
	return nil
}

// downloadVerified streams url to path while hashing it and refuses the file
// unless its SHA-256 matches want.
func downloadVerified(ctx context.Context, url, want, path string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := (&http.Client{Timeout: 30 * time.Minute}).Do(req)
	if err != nil {
		return "", fmt.Errorf("download python: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download python: HTTP %d", res.StatusCode)
	}
	out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	hasher := sha256.New()
	_, err = io.Copy(out, io.TeeReader(res.Body, hasher))
	out.Close()
	if err != nil {
		os.Remove(path)
		return "", fmt.Errorf("download python: %w", err)
	}
	if got := hex.EncodeToString(hasher.Sum(nil)); got != want {
		os.Remove(path)
		return "", fmt.Errorf("download python: checksum mismatch (got %s, want %s)", got, want)
	}
	return path, nil
}

// insideDest reports whether target, resolved from within dest, stays under dest.
func insideDest(dest, target string) bool {
	rel, err := filepath.Rel(dest, target)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func extractTarGz(r io.Reader, dest string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return fmt.Errorf("unsafe path in archive: %s", hdr.Name)
		}
		target := filepath.Join(dest, name)
		// Refuse to write through a symlink created by an earlier entry.
		if parent, err := filepath.EvalSymlinks(filepath.Dir(target)); err == nil && !insideDest(dest, parent) {
			return fmt.Errorf("unsafe path in archive: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode)&0o777|0o600)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			f.Close()
		case tar.TypeSymlink:
			// Links must stay inside the tree: an absolute or escaping
			// target would let later entries write anywhere on disk.
			if filepath.IsAbs(hdr.Linkname) || !insideDest(dest, filepath.Join(filepath.Dir(target), hdr.Linkname)) {
				return fmt.Errorf("unsafe symlink in archive: %s -> %s", hdr.Name, hdr.Linkname)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			os.Remove(target)
			if err := os.Symlink(hdr.Linkname, target); err != nil {
				return err
			}
		}
	}
}
