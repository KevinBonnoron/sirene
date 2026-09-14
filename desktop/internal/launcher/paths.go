package launcher

import (
	"os"
	"path/filepath"
	"runtime"
)

// Paths is the per-user layout under ~/.sirene (SIRENE_HOME overrides it).
type Paths struct {
	Root      string
	PBData    string
	Models    string
	Packages  string
	Cache     string
	Python    string
	Inference string
	Log       string
}

func Default() (Paths, error) {
	root := os.Getenv("SIRENE_HOME")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return Paths{}, err
		}
		root = filepath.Join(home, ".sirene")
	}
	p := Paths{
		Root:      root,
		PBData:    filepath.Join(root, "pb_data"),
		Models:    filepath.Join(root, "models"),
		Packages:  filepath.Join(root, "packages"),
		Cache:     filepath.Join(root, "cache"),
		Python:    filepath.Join(root, "python"),
		Inference: filepath.Join(root, "inference"),
		Log:       filepath.Join(root, "logs"),
	}
	// The tree holds the database, uploaded audio and API keys: owner-only.
	for _, dir := range []string{p.Root, p.PBData, p.Models, p.Packages, p.Cache, p.Log} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return Paths{}, err
		}
	}
	return p, nil
}

func (p Paths) PythonBin() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(p.Python, "python.exe")
	}
	return filepath.Join(p.Python, "bin", "python3")
}
