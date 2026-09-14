from abc import ABC, abstractmethod
from contextlib import contextmanager
from dataclasses import dataclass
import gc
import logging
import os
import tempfile
import time
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class TTSResult:
    audio: np.ndarray  # float32 PCM samples, mono
    sample_rate: int


@dataclass
class GenerateParams:
    text: str
    voice_path: str | None = None
    reference_audio: list[str] | None = None
    reference_audio_data: list[str] | None = None  # base64 data URIs
    reference_cache_key: str | None = None
    reference_text: list[str] | None = None
    # Set once the reference audio is resolved: how many samples, in order,
    # made it into the concatenated clip. The transcript must describe exactly
    # that audio or in-context cloning models speak the difference.
    included_reference_count: int | None = None
    instruct_text: str | None = None
    instruct_gender: str | None = None
    speed: float = 1.0
    noise_scale: float | None = None
    language: str = "en"

    @property
    def has_reference_audio(self) -> bool:
        """True if any form of reference audio is available (URLs, binary data, or cache key)."""
        return bool(
            self.reference_audio
            or self.reference_audio_data
            or self.reference_cache_key
        )

    @property
    def joined_reference_text(self) -> str:
        """Transcript of the reference clip: the segments of the samples that
        were actually concatenated, in order."""
        texts = list(self.reference_text or [])
        if self.included_reference_count is not None:
            texts = texts[: self.included_reference_count]
        return " ".join(t for t in texts if t)


class TTSBackend(ABC):
    name: str

    def __init__(self):
        self._model = None
        self._model_path: Path | None = None
        self._device: str = "cpu"
        self._sample_rate: int = 24000

    @property
    def max_reference_duration(self) -> float:
        """Maximum reference audio duration in seconds. Override per backend."""
        return 25.0

    @abstractmethod
    def load_model(self, model_path: Path, device: str) -> None: ...

    def generate(self, params: GenerateParams) -> TTSResult:
        t0 = time.monotonic()
        result = self._generate(params)
        elapsed = time.monotonic() - t0
        duration = len(result.audio) / result.sample_rate
        logger.debug(
            f"[{self.name}] Generated {duration:.2f}s of audio at {result.sample_rate}Hz "
            f"in {elapsed:.1f}s (RTF={elapsed / max(duration, 0.01):.2f}x)"
        )
        return result

    @abstractmethod
    def _generate(self, params: GenerateParams) -> TTSResult: ...

    def unload_model(self) -> None:
        """Unload the model and free GPU memory. Override to clean up extra resources."""
        logger.info(f"[{self.name}] Unloading model")
        if self._model is not None:
            del self._model
            self._model = None
        self._model_path = None

        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def supports_streaming(self) -> bool:
        return False

    def generate_stream(self, params: GenerateParams):
        """Yield audio in chunks. Defaults to generating full audio then chunking.
        Override for backends with native streaming support."""
        result = self.generate(params)
        chunk_duration = 0.5
        chunk_size = int(result.sample_rate * chunk_duration)
        for i in range(0, len(result.audio), chunk_size):
            chunk = result.audio[i : i + chunk_size]
            yield TTSResult(audio=chunk, sample_rate=result.sample_rate)

    @staticmethod
    def _resolve_device(device: str) -> str:
        """Resolve the requested device, falling back to CPU if CUDA is unavailable."""
        if not device.startswith("cuda"):
            return "cpu"
        try:
            import torch

            if not torch.cuda.is_available():
                raise RuntimeError("CUDA not available")
            torch.zeros(1, device="cuda")
            return device
        except Exception as e:
            logger.warning(f"CUDA requested but unavailable ({e}), falling back to CPU")
            return "cpu"

    @staticmethod
    def _normalize_audio(audio: np.ndarray) -> np.ndarray:
        """Peak-normalize audio to [-1.0, 1.0] if any sample exceeds that range."""
        max_val = np.abs(audio).max()
        if max_val < 1e-6:
            logger.warning(
                "Generated audio is silent (peak=%.2e). "
                "This may indicate a problem with the model or reference audio.",
                max_val,
            )
        elif max_val > 1.0:
            audio = audio / max_val
        return audio

    @contextmanager
    def _reference_audio(
        self, params: "GenerateParams", max_duration: float | None = None
    ):
        """Resolve reference audio with L1 caching, yield the file path.

        Uses params.reference_cache_key as the cache key when provided (stable,
        set by the server from sample IDs). Falls back to URL-based key for
        backward compatibility. Audio is sourced from params.reference_audio_data
        (base64 data URIs) on cache miss, avoiding any network call from the
        inference server.
        """
        from ..services.prompt_cache import get_cache

        if max_duration is None:
            max_duration = self.max_reference_duration

        cache = get_cache()

        if params.reference_cache_key:
            key = params.reference_cache_key
        elif params.reference_audio:
            key = cache.audio_cache_key(params.reference_audio, max_duration)
        else:
            raise ValueError("No reference audio provided")

        # A clip cached before the sample count was tracked is rebuilt: without
        # the count the transcript cannot be trimmed to match it.
        cached_path = cache.get_audio(key)
        included = cache.get_audio_included(key)
        if cached_path and included is not None:
            logger.info(f"[{self.name}] L1 cache hit for reference audio")
            params.included_reference_count = included
            yield cached_path
            return

        if params.reference_audio_data:
            logger.info(
                f"[{self.name}] L1 cache miss, decoding reference audio from request"
            )
            temp_path, included = self._decode_and_concatenate_reference(
                params.reference_audio_data, max_duration
            )
        elif params.reference_audio:
            logger.info(f"[{self.name}] L1 cache miss, downloading reference audio")
            temp_path, included = self._download_and_concatenate_reference(
                params.reference_audio, max_duration
            )
        else:
            raise ValueError(
                "Reference audio cache miss but no audio data provided in request"
            )
        params.included_reference_count = included

        try:
            cached_path = cache.put_audio(key, temp_path, included=included)
            yield cached_path
        except Exception:
            # Cache store failed, fall back to temp path
            if os.path.exists(temp_path):
                try:
                    yield temp_path
                finally:
                    os.unlink(temp_path)
            else:
                raise

    def needs_reference_audio(self, params: "GenerateParams") -> bool:
        """Return True if reference audio is needed but not yet cached.

        Returns False immediately if audio data is already embedded in the request,
        since the data will be decoded and cached during generation.
        """
        if params.reference_audio_data:
            return False

        from ..services.prompt_cache import get_cache

        if params.reference_cache_key:
            key = params.reference_cache_key
        elif params.reference_audio:
            key = get_cache().audio_cache_key(
                params.reference_audio, self.max_reference_duration
            )
        else:
            return False

        cache = get_cache()
        return cache.get_audio(key) is None or cache.get_audio_included(key) is None

    def _decode_and_concatenate_reference(
        self, data_uris: list[str], max_duration: float | None = None
    ) -> tuple[str, int]:
        """Decode base64 data URIs, concatenate whole samples up to max_duration,
        and return the temp file path plus how many samples were included."""
        import base64
        import soundfile as sf

        if max_duration is None:
            max_duration = self.max_reference_duration

        _MIME_TO_EXT = {
            "audio/wav": ".wav",
            "audio/wave": ".wav",
            "audio/x-wav": ".wav",
            "audio/mp3": ".mp3",
            "audio/mpeg": ".mp3",
            "audio/ogg": ".ogg",
            "audio/flac": ".flac",
        }

        def _decode_one(data_uri: str) -> tuple[bytes, str]:
            header, encoded = data_uri.split(",", 1)
            mime = header.split(":")[1].split(";")[0]
            return base64.b64decode(encoded), _MIME_TO_EXT.get(mime, ".wav")

        # Fast path: single file
        if len(data_uris) == 1:
            data, suffix = _decode_one(data_uris[0])
            tmp = tempfile.NamedTemporaryFile(
                suffix=suffix, delete=False, prefix=f"{self.name}_ref_"
            )
            tmp.write(data)
            tmp.flush()
            tmp.close()
            return tmp.name, 1

        all_audio: list[np.ndarray] = []
        target_sr: int | None = None

        for data_uri in data_uris:
            data, suffix = _decode_one(data_uri)
            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            tmp.write(data)
            tmp.flush()
            tmp.close()

            try:
                audio, sr = sf.read(tmp.name, dtype="float32")
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)

                if target_sr is None:
                    target_sr = sr
                elif sr != target_sr:
                    import librosa

                    audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            finally:
                os.unlink(tmp.name)

            if not self._append_reference_sample(all_audio, audio, max_duration, target_sr):
                break

        if not all_audio or target_sr is None:
            raise ValueError("No reference audio could be decoded")

        path = self._write_reference_clip(all_audio, target_sr, len(data_uris))
        return path, len(all_audio)

    def _append_reference_sample(
        self,
        all_audio: list[np.ndarray],
        audio: np.ndarray,
        max_duration: float,
        sr: int,
    ) -> bool:
        """Append a whole sample if it fits within max_duration; a sample is never
        cut in the middle, otherwise its transcript would no longer match. The
        first sample is the only one allowed to be trimmed, so that a single
        long recording still yields a usable clip. Returns False once full."""
        max_samples = int(max_duration * sr)
        current = sum(len(a) for a in all_audio)
        if not all_audio:
            all_audio.append(audio[:max_samples])
            return len(audio) < max_samples
        if current + len(audio) > max_samples:
            logger.info(
                f"[{self.name}] Reference clip full at {current / sr:.1f}s, "
                f"keeping {len(all_audio)} whole samples"
            )
            return False
        all_audio.append(audio)
        return True

    def _write_reference_clip(
        self, all_audio: list[np.ndarray], sr: int, offered: int
    ) -> str:
        import soundfile as sf

        concatenated = np.concatenate(all_audio)
        out_tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, prefix=f"{self.name}_concat_ref_"
        )
        sf.write(out_tmp.name, concatenated, sr)
        out_tmp.close()
        logger.info(
            f"[{self.name}] Concatenated {len(all_audio)}/{offered} samples into "
            f"{len(concatenated) / sr:.1f}s reference audio at {sr}Hz"
        )
        return out_tmp.name

    def _download_and_concatenate_reference(
        self, urls: list[str], max_duration: float | None = None
    ) -> tuple[str, int]:
        """Download multiple reference audio URLs, concatenate whole samples up to
        max_duration, and return the temp file path plus how many were included."""
        import httpx
        import soundfile as sf

        if max_duration is None:
            max_duration = self.max_reference_duration

        # Fast path: single URL - just download and return
        if len(urls) == 1:
            return self._download_single_reference(urls[0]), 1

        all_audio: list[np.ndarray] = []
        target_sr: int | None = None

        for i, url in enumerate(urls):
            logger.info(
                f"[{self.name}] Downloading reference audio {i + 1}/{len(urls)} from {url[:80]}..."
            )
            response = httpx.get(url, timeout=30.0)
            response.raise_for_status()

            suffix = ".wav"
            for ext in (".mp3", ".ogg", ".flac"):
                if ext in url:
                    suffix = ext
                    break

            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            tmp.write(response.content)
            tmp.flush()
            tmp.close()

            try:
                audio, sr = sf.read(tmp.name, dtype="float32")
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)  # mono

                if target_sr is None:
                    target_sr = sr
                elif sr != target_sr:
                    import librosa

                    audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            finally:
                os.unlink(tmp.name)

            if not self._append_reference_sample(all_audio, audio, max_duration, target_sr):
                break

        if not all_audio or target_sr is None:
            raise ValueError("No reference audio files could be loaded")

        path = self._write_reference_clip(all_audio, target_sr, len(urls))
        return path, len(all_audio)

    def _download_single_reference(self, url: str) -> str:
        """Download a single reference audio URL and return a temp file path."""
        import httpx

        logger.info(f"[{self.name}] Downloading reference audio from {url[:80]}...")
        response = httpx.get(url, timeout=30.0)
        response.raise_for_status()

        suffix = ".wav"
        for ext in (".mp3", ".ogg", ".flac"):
            if ext in url:
                suffix = ext
                break

        tmp = tempfile.NamedTemporaryFile(
            suffix=suffix, delete=False, prefix=f"{self.name}_ref_"
        )
        tmp.write(response.content)
        tmp.flush()
        tmp.close()
        logger.info(
            f"[{self.name}] Reference audio saved to {tmp.name} "
            f"({len(response.content)} bytes)"
        )
        return tmp.name
