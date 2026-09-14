package voicezip

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const maxUncompressed = 500 << 20

// Archive is voice.json; key order matches the export the Bun server wrote.
type Archive struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Language    string         `json:"language"`
	Model       string         `json:"model"`
	Options     map[string]any `json:"options"`
	Tags        []string       `json:"tags"`
	Avatar      *string        `json:"avatar"`
	Samples     []Sample       `json:"samples"`
}

type Sample struct {
	File       string  `json:"file"`
	Transcript string  `json:"transcript"`
	Duration   float64 `json:"duration"`
	Order      int     `json:"order"`
}

type ExportSample struct {
	Ext        string
	Transcript string
	Duration   float64
	Order      int
	Data       []byte
}

type ExportInput struct {
	Name        string
	Description string
	Language    string
	Model       string
	Options     map[string]any
	Tags        []string
	AvatarName  string
	AvatarData  []byte
	Samples     []ExportSample
}

func SampleFilename(index int, ext string) string {
	return fmt.Sprintf("sample-%03d.%s", index+1, ext)
}

func Build(in ExportInput) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	archive := Archive{
		Name:        in.Name,
		Description: in.Description,
		Language:    in.Language,
		Model:       in.Model,
		Options:     in.Options,
		Tags:        in.Tags,
		Samples:     []Sample{},
	}
	if archive.Options == nil {
		archive.Options = map[string]any{}
	}
	if archive.Tags == nil {
		archive.Tags = []string{}
	}
	for i, s := range in.Samples {
		name := SampleFilename(i, s.Ext)
		w, err := zw.Create("samples/" + name)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(s.Data); err != nil {
			return nil, err
		}
		archive.Samples = append(archive.Samples, Sample{File: name, Transcript: s.Transcript, Duration: s.Duration, Order: s.Order})
	}
	if in.AvatarName != "" && in.AvatarData != nil {
		archive.Avatar = &in.AvatarName
	}
	meta, err := marshalPretty(archive)
	if err != nil {
		return nil, err
	}
	w, err := zw.Create("voice.json")
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(meta); err != nil {
		return nil, err
	}
	if archive.Avatar != nil {
		w, err := zw.Create(in.AvatarName)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(in.AvatarData); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func marshalPretty(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

var (
	ErrMissingMeta = errors.New("missing voice.json")
	ErrInvalidMeta = errors.New("voice.json is not valid JSON")
	ErrMissingName = errors.New("voice.json is missing a name")
)

type Parsed struct {
	Meta  Archive
	files map[string]*zip.File
}

func Parse(data []byte) (*Parsed, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, ErrMissingMeta
	}
	p := &Parsed{files: map[string]*zip.File{}}
	var total uint64
	for _, f := range zr.File {
		total += f.UncompressedSize64
		if total > maxUncompressed {
			return nil, fmt.Errorf("archive too large")
		}
		p.files[strings.TrimPrefix(f.Name, "/")] = f
	}
	meta, ok := p.files["voice.json"]
	if !ok {
		return nil, ErrMissingMeta
	}
	raw, err := readEntry(meta)
	if err != nil {
		return nil, ErrInvalidMeta
	}
	if err := json.Unmarshal(raw, &p.Meta); err != nil {
		return nil, ErrInvalidMeta
	}
	if p.Meta.Name == "" {
		return nil, ErrMissingName
	}
	return p, nil
}

// Entry returns nil, nil when the archive has no such file.
func (p *Parsed) Entry(name string) ([]byte, error) {
	f, ok := p.files[name]
	if !ok {
		return nil, nil
	}
	return readEntry(f)
}

func readEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}
