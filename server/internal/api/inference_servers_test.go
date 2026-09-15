package api

import "testing"

func TestNormalizeServerURL(t *testing.T) {
	cases := map[string]string{
		"sirene-inference.up.railway.app":      "https://sirene-inference.up.railway.app",
		"  sirene-inference.up.railway.app/  ": "https://sirene-inference.up.railway.app",
		"http://192.168.1.10:8000":             "http://192.168.1.10:8000",
		"https://abc-8000.proxy.runpod.net/":   "https://abc-8000.proxy.runpod.net",
		"HTTP://localhost:8000":                "http://localhost:8000",
	}
	for in, want := range cases {
		got, err := normalizeServerURL(in)
		if err != nil {
			t.Errorf("%q: unexpected error %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
	for _, in := range []string{"", "ftp://x", "http://", "://nope", "http://169.254.169.254/latest", "http://metadata.google.internal", "http://[fe80::1]:8000"} {
		if _, err := normalizeServerURL(in); err == nil {
			t.Errorf("%q: expected an error", in)
		}
	}
}
