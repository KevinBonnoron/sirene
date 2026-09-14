package apierr

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

func TestCodesMatchSharedUnion(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "shared", "src", "types", "error.type.ts"))
	if err != nil {
		t.Fatalf("shared error.type.ts not readable: %v", err)
	}
	re := regexp.MustCompile(`\|\s*'([a-zA-Z.]+)'`)
	var shared []string
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		shared = append(shared, m[1])
	}
	for _, code := range shared {
		if !slices.Contains(AllCodes, code) {
			t.Errorf("shared code %q missing from Go AllCodes", code)
		}
	}
	for _, code := range AllCodes {
		if !slices.Contains(shared, code) {
			t.Errorf("Go code %q missing from shared/src/types/error.type.ts", code)
		}
	}
}
