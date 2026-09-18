package inference

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"
)

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body))}
}

func TestUpstreamErrorCarriesTheWorkerReason(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{
			name:   "a backend that cannot load says which file is missing",
			status: http.StatusInternalServerError,
			body:   `{"detail":"No .onnx file found in /app/data/models/piper-en_US-pda-medium"}`,
			want:   "generateStream failed (HTTP 500): No .onnx file found in /app/data/models/piper-en_US-pda-medium",
		},
		{
			name:   "a client error keeps carrying its reason",
			status: http.StatusBadRequest,
			body:   `{"detail":"Unknown backend: 'nope'"}`,
			want:   "generateStream failed (HTTP 400): Unknown backend: 'nope'",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := upstreamError("generateStream", response(tc.status, tc.body), func(string, ...any) {})
			if err.Error() != tc.want {
				t.Fatalf("got %q, want %q", err.Error(), tc.want)
			}
		})
	}
}

func TestUpstreamErrorWithoutADetailStaysGeneric(t *testing.T) {
	for _, body := range []string{"", "not json at all", `{"detail":""}`, `{"other":"x"}`} {
		err := upstreamError("listModels", response(http.StatusBadGateway, body), func(string, ...any) {})
		if want := "listModels failed (HTTP 502)"; err.Error() != want {
			t.Fatalf("body %q: got %q, want %q", body, err.Error(), want)
		}
	}
}

func TestUpstreamErrorTruncatesADump(t *testing.T) {
	long := strings.Repeat("x", maxUpstreamDetail+50)
	err := upstreamError("pull", response(http.StatusInternalServerError, `{"detail":"`+long+`"}`), func(string, ...any) {})
	if !strings.HasSuffix(err.Error(), "…") {
		t.Fatalf("expected an elided message, got %q", err.Error())
	}
	if len(err.Error()) > maxUpstreamDetail+64 {
		t.Fatalf("message not truncated: %d chars", len(err.Error()))
	}
}

func TestUpstreamErrorTruncatesOnRuneBoundaries(t *testing.T) {
	long := strings.Repeat("é", maxUpstreamDetail+50)
	err := upstreamError("pull", response(http.StatusInternalServerError, `{"detail":"`+long+`"}`), func(string, ...any) {})
	if !utf8.ValidString(err.Error()) {
		t.Fatalf("message cut inside a rune: %q", err.Error())
	}
	if strings.ContainsRune(err.Error(), utf8.RuneError) {
		t.Fatalf("message carries a replacement character: %q", err.Error())
	}
}
