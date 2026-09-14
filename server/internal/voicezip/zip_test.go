package voicezip

import (
	"errors"
	"testing"
)

func TestBuildAndParseRoundTrip(t *testing.T) {
	avatar := "avatar.png"
	data, err := Build(ExportInput{
		Name: "Alice", Language: "fr", Tags: []string{"a"}, Options: map[string]any{"presetVoice": "x"},
		AvatarName: avatar, AvatarData: []byte("png"),
		Samples: []ExportSample{{Ext: "wav", Transcript: "hi", Duration: 1.5, Order: 0, Data: []byte("RIFF")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	p, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if p.Meta.Name != "Alice" || p.Meta.Avatar == nil || *p.Meta.Avatar != avatar || len(p.Meta.Samples) != 1 || p.Meta.Samples[0].File != "sample-001.wav" {
		t.Fatalf("unexpected meta %+v", p.Meta)
	}
	if b, _ := p.Entry("samples/sample-001.wav"); string(b) != "RIFF" {
		t.Fatal("sample bytes lost")
	}
	if b, _ := p.Entry("missing"); b != nil {
		t.Fatal("missing entry must be nil")
	}
}

func TestParseErrors(t *testing.T) {
	if _, err := Parse([]byte("not a zip")); !errors.Is(err, ErrMissingMeta) {
		t.Fatalf("expected missing meta, got %v", err)
	}
}
