package catalog

import (
	_ "embed"
	"encoding/json"
	"slices"
)

//go:embed models.json
var modelsJSON []byte

// CatalogFile is either a bare path (same repo as the model) or an object
// with a custom repo / remote path. It marshals back to the bare form when
// possible so /models/catalog stays byte-identical to the manifest.
type CatalogFile struct {
	Path       string
	Repo       string
	RemotePath string
}

func (f *CatalogFile) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*f = CatalogFile{Path: s}
		return nil
	}
	var obj struct {
		Path       string `json:"path"`
		Repo       string `json:"repo,omitempty"`
		RemotePath string `json:"remotePath,omitempty"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	*f = CatalogFile{Path: obj.Path, Repo: obj.Repo, RemotePath: obj.RemotePath}
	return nil
}

func (f CatalogFile) MarshalJSON() ([]byte, error) {
	if f.Repo == "" && f.RemotePath == "" {
		return json.Marshal(f.Path)
	}
	return json.Marshal(struct {
		Path       string `json:"path"`
		Repo       string `json:"repo,omitempty"`
		RemotePath string `json:"remotePath,omitempty"`
	}{f.Path, f.Repo, f.RemotePath})
}

type PresetVoice struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type Model struct {
	ID                   string        `json:"id"`
	Name                 string        `json:"name"`
	Backend              string        `json:"backend"`
	BackendDisplayName   string        `json:"backendDisplayName"`
	BackendDescription   string        `json:"backendDescription"`
	Description          string        `json:"description"`
	Repo                 string        `json:"repo"`
	Files                []CatalogFile `json:"files"`
	Size                 int64         `json:"size"`
	Types                []string      `json:"types"`
	PresetVoices         []PresetVoice `json:"presetVoices,omitempty"`
	MaxReferenceDuration float64       `json:"maxReferenceDuration,omitempty"`
	Gated                bool          `json:"gated,omitempty"`
	Language             string        `json:"language,omitempty"`
	SupportsInstruct     bool          `json:"supportsInstruct,omitempty"`
	SupportsEffects      bool          `json:"supportsEffects,omitempty"`
}

func (m Model) HasType(t string) bool {
	return slices.Contains(m.Types, t)
}

var Models []Model

func init() {
	if err := json.Unmarshal(modelsJSON, &Models); err != nil {
		panic("catalog: invalid models.json: " + err.Error())
	}
}

func ByID(id string) (Model, bool) {
	for _, m := range Models {
		if m.ID == id {
			return m, true
		}
	}
	return Model{}, false
}

func IsCatalogID(id string) bool {
	_, ok := ByID(id)
	return ok
}
