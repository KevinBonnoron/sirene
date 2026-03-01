import io
import struct

import numpy as np


def pcm_to_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    """Encode float32 PCM array to WAV bytes (16-bit, mono)."""
    audio_clamped = np.clip(audio, -1.0, 1.0)
    pcm16 = (audio_clamped * 32767).astype(np.int16)

    buf = io.BytesIO()
    num_channels = 1
    bytes_per_sample = 2
    data_size = len(pcm16) * bytes_per_sample * num_channels

    # RIFF header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    # fmt chunk
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))  # PCM
    buf.write(struct.pack("<H", num_channels))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * num_channels * bytes_per_sample))
    buf.write(struct.pack("<H", num_channels * bytes_per_sample))
    buf.write(struct.pack("<H", bytes_per_sample * 8))
    # data chunk
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm16.tobytes())

    return buf.getvalue()


def pcm_to_raw_chunks(audio: np.ndarray, chunk_size: int = 4096):
    """Yield raw PCM int16 bytes in chunks for streaming."""
    audio_clamped = np.clip(audio, -1.0, 1.0)
    pcm16 = (audio_clamped * 32767).astype(np.int16)
    raw = pcm16.tobytes()
    for i in range(0, len(raw), chunk_size):
        yield raw[i : i + chunk_size]


def stream_pcm_chunks(results, chunk_size: int = 4096):
    """Yield raw PCM int16 bytes from a generator of TTSResult objects.

    Buffers bytes internally so each yielded chunk is exactly *chunk_size*
    bytes (except possibly the last one).
    """
    buf = b""
    for result in results:
        audio_clamped = np.clip(result.audio, -1.0, 1.0)
        pcm16 = (audio_clamped * 32767).astype(np.int16)
        buf += pcm16.tobytes()
        while len(buf) >= chunk_size:
            yield buf[:chunk_size]
            buf = buf[chunk_size:]
    if buf:
        yield buf
