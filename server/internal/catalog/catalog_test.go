package catalog

import (
	"encoding/json"
	"testing"
)

func TestCatalogLoadsAndRoundTrips(t *testing.T) {
	if len(Models) != 49 {
		t.Fatalf("expected 49 models, got %d", len(Models))
	}
	seen := map[string]bool{}
	for _, m := range Models {
		if seen[m.ID] {
			t.Fatalf("duplicate id %s", m.ID)
		}
		seen[m.ID] = true
	}
	out, err := json.Marshal(Models)
	if err != nil {
		t.Fatal(err)
	}
	var want, got []any
	if err := json.Unmarshal(modelsJSON, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	w, _ := json.Marshal(want)
	g, _ := json.Marshal(got)
	if string(w) != string(g) {
		t.Fatal("catalog does not round-trip byte-identically through the Go structs")
	}
}
