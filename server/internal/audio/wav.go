package audio

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
)

const HeaderSize = 44

// Must stay byte-identical to shared/src/wav.ts.
func WriteHeader(dst []byte, dataLen int, sampleRate int) {
	copy(dst[0:4], "RIFF")
	binary.LittleEndian.PutUint32(dst[4:8], uint32(36+dataLen))
	copy(dst[8:12], "WAVE")
	copy(dst[12:16], "fmt ")
	binary.LittleEndian.PutUint32(dst[16:20], 16)
	binary.LittleEndian.PutUint16(dst[20:22], 1)
	binary.LittleEndian.PutUint16(dst[22:24], 1)
	binary.LittleEndian.PutUint32(dst[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(dst[28:32], uint32(sampleRate*2))
	binary.LittleEndian.PutUint16(dst[32:34], 2)
	binary.LittleEndian.PutUint16(dst[34:36], 16)
	copy(dst[36:40], "data")
	binary.LittleEndian.PutUint32(dst[40:44], uint32(dataLen))
}

func BuildWAV(pcm []byte, sampleRate int) []byte {
	out := make([]byte, HeaderSize+len(pcm))
	WriteHeader(out, len(pcm), sampleRate)
	copy(out[HeaderSize:], pcm)
	return out
}

type Accumulator struct {
	buf        bytes.Buffer
	sampleRate int
}

func NewAccumulator(sampleRate int) *Accumulator {
	a := &Accumulator{sampleRate: sampleRate}
	a.buf.Write(make([]byte, HeaderSize))
	return a
}

func (a *Accumulator) Write(p []byte) (int, error) {
	return a.buf.Write(p)
}

func (a *Accumulator) PCMBytes() int {
	return a.buf.Len() - HeaderSize
}

func (a *Accumulator) Duration() float64 {
	return float64(a.PCMBytes()) / float64(2*a.sampleRate)
}

func (a *Accumulator) Bytes() []byte {
	out := a.buf.Bytes()
	WriteHeader(out, a.PCMBytes(), a.sampleRate)
	return out
}

type Info struct {
	SampleRate    int
	Channels      int
	BitsPerSample int
	Duration      float64
}

var ErrNotWAV = errors.New("not a RIFF/WAVE file")

func ParseWAV(r io.ReadSeeker) (Info, error) {
	var riff [12]byte
	if _, err := io.ReadFull(r, riff[:]); err != nil {
		return Info{}, ErrNotWAV
	}
	if string(riff[0:4]) != "RIFF" || string(riff[8:12]) != "WAVE" {
		return Info{}, ErrNotWAV
	}
	var info Info
	blockAlign := 0
	for {
		var hdr [8]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			break
		}
		id := string(hdr[0:4])
		size := int64(binary.LittleEndian.Uint32(hdr[4:8]))
		switch id {
		case "fmt ":
			var fmtChunk [16]byte
			if size < 16 {
				return Info{}, ErrNotWAV
			}
			if _, err := io.ReadFull(r, fmtChunk[:]); err != nil {
				return Info{}, ErrNotWAV
			}
			info.Channels = int(binary.LittleEndian.Uint16(fmtChunk[2:4]))
			info.SampleRate = int(binary.LittleEndian.Uint32(fmtChunk[4:8]))
			blockAlign = int(binary.LittleEndian.Uint16(fmtChunk[12:14]))
			info.BitsPerSample = int(binary.LittleEndian.Uint16(fmtChunk[14:16]))
			if _, err := r.Seek(size-16+size%2, io.SeekCurrent); err != nil {
				return Info{}, ErrNotWAV
			}
		case "data":
			if info.SampleRate == 0 || blockAlign == 0 {
				return Info{}, ErrNotWAV
			}
			info.Duration = float64(size) / float64(info.SampleRate*blockAlign)
			return info, nil
		default:
			if _, err := r.Seek(size+size%2, io.SeekCurrent); err != nil {
				return Info{}, ErrNotWAV
			}
		}
	}
	return Info{}, ErrNotWAV
}
