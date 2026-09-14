package audio

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// Golden bytes produced by shared/src/wav.ts buildWav([[1,2,3,4]], 4, 24000).
const golden = "524946462800000057415645666d74201000000001000100c05d0000" + "80bb0000" + "02001000" + "64617461040000000102030" + "4"

func TestBuildWAVMatchesShared(t *testing.T) {
	want, err := hex.DecodeString(golden)
	if err != nil {
		t.Fatal(err)
	}
	got := BuildWAV([]byte{1, 2, 3, 4}, 24000)
	if !bytes.Equal(got, want) {
		t.Fatalf("header mismatch\n got %x\nwant %x", got, want)
	}
	acc := NewAccumulator(24000)
	acc.Write([]byte{1, 2})
	acc.Write([]byte{3, 4})
	if !bytes.Equal(acc.Bytes(), want) {
		t.Fatalf("accumulator mismatch\n got %x\nwant %x", acc.Bytes(), want)
	}
}

func TestParseWAVRoundTrip(t *testing.T) {
	pcm := make([]byte, 24000*2)
	info, err := ParseWAV(bytes.NewReader(BuildWAV(pcm, 24000)))
	if err != nil {
		t.Fatal(err)
	}
	if info.SampleRate != 24000 || info.Channels != 1 || info.BitsPerSample != 16 || info.Duration != 1 {
		t.Fatalf("unexpected info %+v", info)
	}
	if _, err := ParseWAV(bytes.NewReader([]byte("ID3 not a wav"))); err == nil {
		t.Fatal("expected error for non-wav input")
	}
}
