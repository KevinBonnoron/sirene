from abc import ABC, abstractmethod
from contextlib import contextmanager
from dataclasses import dataclass
import gc
import logging
import os
import random
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

from ..services import dsp

logger = logging.getLogger(__name__)


@dataclass
class TTSResult:
    audio: np.ndarray
    sample_rate: int


@dataclass
class GenerateParams:
    text: str
    voice_path: str | None = None
    reference_audio: list[str] | None = None
    reference_audio_data: list[str] | None = None
    reference_cache_key: str | None = None
    reference_text: list[str] | None = None
    # Samples that made it into the concatenated clip; the transcript must match exactly
    # or in-context cloning models speak the difference.
    included_reference_count: int | None = None
    instruct_text: str | None = None
    instruct_gender: str | None = None
    speed: float = 1.0
    pitch_shift: float = 0.0
    noise_scale: float | None = None
    seed: int | None = None
    language: str = "en"

    @property
    def has_reference_audio(self) -> bool:
        return bool(
            self.reference_audio
            or self.reference_audio_data
            or self.reference_cache_key
        )

    @property
    def joined_reference_text(self) -> str:
        texts = list(self.reference_text or [])
        if self.included_reference_count is not None:
            texts = texts[: self.included_reference_count]
        return " ".join(t for t in texts if t)


class _SamplingGate:
    """Many unseeded generations at once, or one seeded generation alone.

    Seeding sets the process-wide RNGs, and any other local sampling draws from the same
    stream: letting one run alongside a seeded take would make that take's output depend on
    how the two interleaved, which is the opposite of what a seed is for.
    """

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._readers = 0
        self._writer = False
        self._waiting_writers = 0

    @contextmanager
    def shared(self):
        with self._cond:
            # Waiting writers go first, or a steady stream of unseeded takes starves them.
            while self._writer or self._waiting_writers:
                self._cond.wait()
            self._readers += 1
        try:
            yield
        finally:
            with self._cond:
                self._readers -= 1
                if self._readers == 0:
                    self._cond.notify_all()

    @contextmanager
    def exclusive(self):
        with self._cond:
            self._waiting_writers += 1
            while self._writer or self._readers:
                self._cond.wait()
            self._waiting_writers -= 1
            self._writer = True
        try:
            yield
        finally:
            with self._cond:
                self._writer = False
                self._cond.notify_all()


SAMPLING_GATE = _SamplingGate()


class TTSBackend(ABC):
    name: str
    # False means the backend ignores params.speed and the post-processor stretches for it.
    handles_speed: bool = False
    # False when generation happens elsewhere: nothing to seed, no model state to protect,
    # and serialising it would hold a lock for the length of a network round trip.
    samples_locally: bool = True

    def __init__(self):
        # Backends keep per-call state on the model object, so one generation at a time per
        # instance — but two different models may run at once.
        self.generation_lock = threading.Lock()
        self._model = None
        self._model_path: Path | None = None
        self._device: str = "cpu"
        self._sample_rate: int = 24000

    @property
    def max_reference_duration(self) -> float:
        return 25.0

    @abstractmethod
    def load_model(self, model_path: Path, device: str) -> None: ...

    # Pitch and, on backends that ignore speed, the tempo are applied to the rendered
    # signal. Both need the whole take, so a stream has to be buffered to honour them.
    def needs_post_processing(self, params: GenerateParams) -> bool:
        return dsp.shifts_pitch(params.pitch_shift) or (
            not self.handles_speed and dsp.stretches(params.speed)
        )

    # Whether this request can go out as a native stream. Buffering it instead costs
    # latency but keeps the keepalive, which is what holds the connection open.
    def can_stream(self, params: GenerateParams) -> bool:
        return self.supports_streaming() and not self.needs_post_processing(params)

    def _post_process(self, params: GenerateParams, result: TTSResult) -> TTSResult:
        if not self.needs_post_processing(params):
            return result
        audio = result.audio
        if not self.handles_speed and dsp.stretches(params.speed):
            audio = dsp.time_stretch(audio, 1.0 / params.speed)
        if dsp.shifts_pitch(params.pitch_shift):
            audio = dsp.pitch_shift(audio, params.pitch_shift)
        return TTSResult(audio=audio, sample_rate=result.sample_rate)

    def generate(self, params: GenerateParams) -> TTSResult:
        self._apply_seed(params)
        t0 = time.monotonic()
        result = self._post_process(params, self._generate(params))
        elapsed = time.monotonic() - t0
        duration = len(result.audio) / result.sample_rate
        logger.debug(
            f"[{self.name}] Generated {duration:.2f}s of audio at {result.sample_rate}Hz "
            f"in {elapsed:.1f}s (RTF={elapsed / max(duration, 0.01):.2f}x)"
        )
        return result

    @abstractmethod
    def _generate(self, params: GenerateParams) -> TTSResult: ...

    # Sampling backends draw tokens at random; the same seed makes a take reproducible and the variation slider meaningful.
    def _apply_seed(self, params: GenerateParams) -> None:
        if params.seed is None or not self.samples_locally:
            return
        seed = params.seed % (2**63)
        random.seed(seed)
        np.random.seed(seed % (2**32))
        try:
            import torch

            torch.manual_seed(seed)
        except ImportError:
            pass

    def unload_model(self) -> None:
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
        result = self.generate(params)
        chunk_duration = 0.5
        chunk_size = int(result.sample_rate * chunk_duration)
        for i in range(0, len(result.audio), chunk_size):
            chunk = result.audio[i : i + chunk_size]
            yield TTSResult(audio=chunk, sample_rate=result.sample_rate)

    # An allocation, not just a capability flag: a driver can report a device it then
    # refuses to allocate on, and finding that out at load time beats finding it out
    # halfway through a generation.
    @staticmethod
    def _resolve_device(device: str) -> str:
        if device.startswith("cuda"):
            return TTSBackend._probe(
                device, "cuda", lambda torch: torch.cuda.is_available()
            )
        if device == "mps":
            return TTSBackend._probe(
                "mps", "MPS", lambda torch: torch.backends.mps.is_available()
            )
        return "cpu"

    @staticmethod
    def _probe(device: str, label: str, available) -> str:
        try:
            import torch

            if not available(torch):
                raise RuntimeError(f"{label} not available")
            torch.zeros(1, device=device)
            return device
        except Exception as e:
            logger.warning(f"{label} requested but unusable ({e}), falling back to CPU")
            return "cpu"

    @staticmethod
    def _normalize_audio(audio: np.ndarray) -> np.ndarray:
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

        # Clips cached without a sample count are rebuilt: the transcript cannot be trimmed to match.
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
            if os.path.exists(temp_path):
                try:
                    yield temp_path
                finally:
                    os.unlink(temp_path)
            else:
                raise

    def needs_reference_audio(self, params: "GenerateParams") -> bool:
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

            if not self._append_reference_sample(
                all_audio, audio, max_duration, target_sr
            ):
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
        # Samples are never cut mid-way (the transcript would drift); only the first may be
        # trimmed so a single long recording still yields a clip.
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
        import httpx
        import soundfile as sf

        if max_duration is None:
            max_duration = self.max_reference_duration

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
                    audio = audio.mean(axis=1)

                if target_sr is None:
                    target_sr = sr
                elif sr != target_sr:
                    import librosa

                    audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            finally:
                os.unlink(tmp.name)

            if not self._append_reference_sample(
                all_audio, audio, max_duration, target_sr
            ):
                break

        if not all_audio or target_sr is None:
            raise ValueError("No reference audio files could be loaded")

        path = self._write_reference_clip(all_audio, target_sr, len(urls))
        return path, len(all_audio)

    def _download_single_reference(self, url: str) -> str:
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
