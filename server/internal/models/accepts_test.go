package models

import "testing"

func TestAccepts(t *testing.T) {
	const gib = 1 << 30
	cases := []struct {
		name            string
		policy, hw, dev string
		minVram         int
		vram            int64
		want            bool
	}{
		{"gpu model on cpu worker", "all", "gpu", "cpu", 0, 0, false},
		{"all takes a cpu model", "all", "cpu", "cpu", 0, 0, true},
		{"all takes a gpu model on cuda", "all", "gpu", "cuda", 0, 0, true},
		{"cpu policy refuses gpu model", "cpu", "gpu", "cuda", 0, 0, false},
		{"gpu policy refuses cpu model", "gpu", "cpu", "cuda", 0, 0, false},
		{"gpu policy takes gpu model", "gpu", "gpu", "cuda", 0, 0, true},
		{"none refuses everything", "none", "cpu", "cuda", 0, 0, false},
		{"unknown policy behaves as all", "", "cpu", "cpu", 0, 0, true},
		{"vram floor refuses a small gpu", "all", "gpu", "cuda", 16, 8 * gib, false},
		{"vram floor passes a big gpu", "all", "gpu", "cuda", 16, 24 * gib, true},
		{"vram floor ignored when unknown", "all", "gpu", "cuda", 16, 0, true},
	}
	for _, c := range cases {
		if got := Accepts(c.policy, c.hw, c.minVram, c.dev, c.vram); got != c.want {
			t.Errorf("%s: Accepts(%q,%q,%d,%q,%d) = %v, want %v", c.name, c.policy, c.hw, c.minVram, c.dev, c.vram, got, c.want)
		}
	}
}
