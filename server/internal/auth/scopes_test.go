package auth

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

func TestScopesMatchShared(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "shared", "src", "types", "api-key.type.ts"))
	if err != nil {
		t.Fatalf("shared api-key.type.ts not readable: %v", err)
	}
	block := regexp.MustCompile(`API_KEY_SCOPES = \[([^\]]*)\]`).FindStringSubmatch(string(src))
	if block == nil {
		t.Fatal("API_KEY_SCOPES not found in shared types")
	}
	var shared []string
	for _, m := range regexp.MustCompile(`'([a-z:-]+)'`).FindAllStringSubmatch(block[1], -1) {
		shared = append(shared, m[1])
	}
	if !slices.Equal(shared, Scopes) {
		t.Fatalf("scopes differ\n shared: %v\n go:     %v", shared, Scopes)
	}
}
