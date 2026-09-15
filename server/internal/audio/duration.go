package audio

import (
	"bytes"
	"context"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Non-WAV clips fall back to ffprobe; 0 is what the UI treats as unknown.
func Duration(ctx context.Context, data []byte) float64 {
	if info, err := ParseWAV(bytes.NewReader(data)); err == nil {
		return round1(info.Duration)
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return 0
	}
	tmp, err := os.CreateTemp("", "sirene-audio-*")
	if err != nil {
		return 0
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return 0
	}
	tmp.Close()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "quiet", "-protocol_whitelist", "file", "-show_entries", "format=duration", "-of", "csv=p=0", tmp.Name()).Output()
	if err != nil {
		return 0
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0
	}
	return round1(d)
}

func round1(d float64) float64 {
	return math.Round(d*10) / 10
}
