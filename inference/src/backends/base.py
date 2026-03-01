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
    reference_text: list[str] | None = None
    instruct_text: str | None = None
    instruct_gender: str | None = None
    speed: float = 1.0
    language: str = "en"

    @property
    def joined_reference_text(self) -> str:
        """Join all non-empty reference text segments into a single string."""
        return " ".join(t for t in (self.reference_text or []) if t)


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
    def _reference_audio(self, urls: list[str], max_duration: float | None = None):
        """Download reference audio with L1 caching, yield the file path."""
        from ..services.prompt_cache import get_cache

        if max_duration is None:
            max_duration = self.max_reference_duration

        cache = get_cache()
        key = cache.audio_cache_key(urls, max_duration)

        cached_path = cache.get_audio(key)
        if cached_path:
            logger.info(f"[{self.name}] L1 cache hit for reference audio")
            yield cached_path
            return

        logger.info(f"[{self.name}] L1 cache miss, downloading reference audio")
        temp_path = self._download_and_concatenate_reference(urls, max_duration)
        try:
            cached_path = cache.put_audio(key, temp_path)
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

    def _download_and_concatenate_reference(
        self, urls: list[str], max_duration: float | None = None
    ) -> str:
        """Download multiple reference audio URLs, concatenate, and return a
        temp file path. Truncates to max_duration seconds."""
        import httpx
        import soundfile as sf

        if max_duration is None:
            max_duration = self.max_reference_duration

        # Fast path: single URL — just download and return
        if len(urls) == 1:
            return self._download_single_reference(urls[0])

        all_audio: list[np.ndarray] = []
        target_sr: int | None = None
        cumulative_samples = 0

        for i, url in enumerate(urls):
            logger.info(f"[{self.name}] Downloading reference audio {i + 1}/{len(urls)} from {url[:80]}...")
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

                    audio = librosa.resample(
                        audio, orig_sr=sr, target_sr=target_sr
                    )

                all_audio.append(audio)
                cumulative_samples += len(audio)

                # Stop downloading once we have enough audio
                max_samples = int(max_duration * target_sr)
                if cumulative_samples >= max_samples:
                    logger.info(
                        f"[{self.name}] Reached {max_duration:.0f}s limit after "
                        f"{i + 1}/{len(urls)} samples, skipping remaining"
                    )
                    break
            finally:
                os.unlink(tmp.name)

        if not all_audio or target_sr is None:
            raise ValueError("No reference audio files could be loaded")

        concatenated = np.concatenate(all_audio)

        # Truncate to exact max duration
        max_samples = int(max_duration * target_sr)
        if len(concatenated) > max_samples:
            concatenated = concatenated[:max_samples]

        # Write concatenated result to temp file
        out_tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, prefix=f"{self.name}_concat_ref_"
        )
        sf.write(out_tmp.name, concatenated, target_sr)
        out_tmp.close()

        total_duration = len(concatenated) / target_sr
        logger.info(
            f"[{self.name}] Concatenated {len(all_audio)} samples into "
            f"{total_duration:.1f}s reference audio at {target_sr}Hz"
        )
        return out_tmp.name

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
