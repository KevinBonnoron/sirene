import io
import logging
import os
import subprocess
import time
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)

_DEFAULT_PORT = 8091

PRESET_VOICES = [
    "ar_male",
    "de_female",
    "de_male",
    "es_female",
    "es_male",
    "fr_female",
    "fr_male",
    "hi_female",
    "hi_male",
    "it_female",
    "it_male",
    "nl_female",
    "nl_male",
    "pt_female",
    "pt_male",
    "casual_female",
    "casual_male",
    "cheerful_female",
    "neutral_female",
    "neutral_male",
]


def _get_port() -> int:
    return int(os.environ.get("VOXTRAL_PORT", str(_DEFAULT_PORT)))


class VoxtralBackend(TTSBackend):
    name = "voxtral"

    def __init__(self):
        super().__init__()
        self._sample_rate = 24000
        self._server_url: str | None = None
        self._server_process: subprocess.Popen | None = None
        self._cloned_voices: dict[str, str] = {}

    def load_model(self, model_path: Path, device: str) -> None:
        import httpx

        logger.info("[voxtral] Loading model from %s on %s", model_path, device)

        self._model_path = model_path
        self._device = self._resolve_device(device)

        external_url = self._detect_external_server()
        if external_url:
            self._server_url = external_url
            logger.info(
                "[voxtral] Connected to external vLLM-Omni server at %s",
                self._server_url,
            )
            self._model = True  # Sentinel so is_loaded() returns True
            return

        if not self._device.startswith("cuda"):
            raise RuntimeError(
                "Voxtral requires a CUDA GPU (≥16 GB VRAM). "
                "CPU inference is not supported by vLLM."
            )

        self._start_server(model_path, device)
        self._model = True
        logger.info("[voxtral] Model server started at %s", self._server_url)

    def _detect_external_server(self) -> str | None:
        import httpx

        url = os.environ.get("VOXTRAL_SERVER_URL")
        if not url:
            url = f"http://localhost:{_get_port()}"

        try:
            response = httpx.get(f"{url}/health", timeout=2.0)
            if response.status_code == 200:
                return url
        except httpx.ConnectError:
            pass
        except Exception:
            pass

        if os.environ.get("VOXTRAL_SERVER_URL"):
            raise RuntimeError(
                f"VOXTRAL_SERVER_URL is set to {url} but the server is not reachable. "
                f"Start the vLLM-Omni server or unset the variable to let Sirene manage it."
            )
        return None

    def _start_server(self, model_path: Path, device: str) -> None:
        import httpx

        port = _get_port()
        self._server_url = f"http://localhost:{port}"

        cmd = [
            "vllm",
            "serve",
            str(model_path),
            "--omni",
            "--port",
            str(port),
            "--trust-remote-code",
            "--enforce-eager",
        ]

        if device.startswith("cuda"):
            pass
        else:
            cmd += ["--device", "cpu"]

        logger.info("[voxtral] Starting vLLM-Omni server on port %d", port)
        self._server_process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self._server_process.poll() is not None:
                raise RuntimeError(
                    f"vLLM-Omni server exited during startup (code {self._server_process.returncode}). "
                    "Check that vLLM-Omni is installed and the GPU has ≥16 GB VRAM."
                )
            try:
                response = httpx.get(f"{self._server_url}/health", timeout=2.0)
                if response.status_code == 200:
                    return
            except Exception:
                pass
            time.sleep(2)

        self._kill_server()
        raise RuntimeError(
            "vLLM-Omni server did not become healthy within 120 seconds. "
            "Check GPU memory (>= 16 GB VRAM required) and model path."
        )

    def _kill_server(self) -> None:
        if self._server_process is None:
            return
        self._server_process.terminate()
        try:
            self._server_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._server_process.kill()
            self._server_process.wait(timeout=5)
        self._server_process = None

    def unload_model(self) -> None:
        logger.info("[voxtral] Unloading model")
        if self._server_process is not None:
            logger.info("[voxtral] Stopping managed vLLM-Omni server")
            self._kill_server()

        self._server_url = None
        self._cloned_voices.clear()
        self._model = None
        self._model_path = None

        import gc

        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def supports_streaming(self) -> bool:
        return True

    def _resolve_voice(self, params: GenerateParams) -> str:
        if params.voice_path and params.voice_path in PRESET_VOICES:
            return params.voice_path

        cache_key = params.reference_cache_key
        if cache_key and cache_key in self._cloned_voices:
            return self._cloned_voices[cache_key]

        return "casual_female"

    def _clone_voice_if_needed(self, params: GenerateParams) -> str | None:
        if not params.has_reference_audio:
            return None

        cache_key = params.reference_cache_key
        if cache_key and cache_key in self._cloned_voices:
            return self._cloned_voices[cache_key]

        if not params.reference_audio and not params.reference_audio_data:
            return None

        with self._reference_audio(params) as ref_audio_path:
            voice_id = self._upload_reference_voice(
                ref_audio_path,
                params.joined_reference_text or None,
            )
            if cache_key:
                self._cloned_voices[cache_key] = voice_id
            return voice_id

    def _upload_reference_voice(
        self, ref_audio_path: str, ref_text: str | None = None
    ) -> str:
        import httpx

        logger.info("[voxtral] Uploading reference audio for voice cloning")

        with open(ref_audio_path, "rb") as f:
            files = {"audio_sample": ("reference.wav", f, "audio/wav")}
            data = {}
            if ref_text:
                data["transcript"] = ref_text

            response = httpx.post(
                f"{self._server_url}/v1/audio/voices",
                files=files,
                data=data,
                timeout=60.0,
            )
            response.raise_for_status()

        result = response.json()
        voice_id = result.get("voice_id") or result.get("id")
        if not voice_id:
            raise RuntimeError(
                f"Voice cloning response did not contain a voice_id: {result}"
            )

        logger.info("[voxtral] Voice cloned successfully: %s", voice_id)
        return voice_id

    def _generate(self, params: GenerateParams) -> TTSResult:
        import httpx
        import soundfile as sf

        if not self.is_loaded():
            raise RuntimeError("Voxtral model not loaded")

        logger.info("[voxtral] Generating request (%d chars)", len(params.text))

        cloned_voice = self._clone_voice_if_needed(params)
        voice = cloned_voice or self._resolve_voice(params)

        payload = {
            "input": params.text,
            "voice": voice,
            "response_format": "wav",
            "speed": params.speed,
        }

        response = httpx.post(
            f"{self._server_url}/v1/audio/speech",
            json=payload,
            timeout=120.0,
        )
        response.raise_for_status()

        audio, sr = sf.read(io.BytesIO(response.content), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        self._sample_rate = sr
        audio = self._normalize_audio(audio)

        logger.info(
            "[voxtral] Generated %.2fs of audio at %dHz",
            len(audio) / sr,
            sr,
        )
        return TTSResult(audio=audio, sample_rate=sr)

    def generate_stream(self, params: GenerateParams):
        import httpx

        if not self.is_loaded():
            raise RuntimeError("Voxtral model not loaded")

        logger.info("[voxtral] Streaming request (%d chars)", len(params.text))

        if params.speed != 1.0:
            logger.warning(
                "[voxtral] Speed %.2f requested but streaming does not support "
                "non-default speed; falling back to non-streaming generation",
                params.speed,
            )
            yield from super().generate_stream(params)
            return

        cloned_voice = self._clone_voice_if_needed(params)
        voice = cloned_voice or self._resolve_voice(params)

        payload = {
            "input": params.text,
            "voice": voice,
            "stream": True,
            "response_format": "pcm",
        }

        with httpx.stream(
            "POST",
            f"{self._server_url}/v1/audio/speech",
            json=payload,
            timeout=120.0,
        ) as response:
            response.raise_for_status()
            buffer = b""
            bytes_per_sample = 2
            chunk_samples = int(self._sample_rate * 0.5)
            chunk_bytes = chunk_samples * bytes_per_sample

            for raw in response.iter_bytes(chunk_size=chunk_bytes):
                buffer += raw
                while len(buffer) >= chunk_bytes:
                    chunk_data = buffer[:chunk_bytes]
                    buffer = buffer[chunk_bytes:]

                    samples = (
                        np.frombuffer(chunk_data, dtype=np.int16).astype(np.float32)
                        / 32768.0
                    )
                    samples = self._normalize_audio(samples)
                    yield TTSResult(audio=samples, sample_rate=self._sample_rate)

            if len(buffer) >= bytes_per_sample:
                usable = len(buffer) - (len(buffer) % bytes_per_sample)
                if usable > 0:
                    samples = (
                        np.frombuffer(buffer[:usable], dtype=np.int16).astype(
                            np.float32
                        )
                        / 32768.0
                    )
                    samples = self._normalize_audio(samples)
                    yield TTSResult(audio=samples, sample_rate=self._sample_rate)
