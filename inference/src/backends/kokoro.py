import json
import logging
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)

SAMPLE_RATE = 24000
MAX_PHONEME_LENGTH = 510  # 512 context minus 2 pad tokens

DEFAULT_VOICES: dict[str, str] = {
    "en": "af_heart",
    "en-us": "af_heart",
    "en-gb": "bf_emma",
    "fr": "ff_siwis",
    "ja": "jf_alpha",
    "zh": "zf_xiaoni",
    "hi": "hf_alpha",
    "it": "if_sara",
    "pt": "pf_dora",
    "es": "ef_dora",
    "de": "ef_dora",
}

_MISAKI_LANGUAGES = {"en", "zh"}

_ESPEAK_LANG_MAP: dict[str, str] = {
    "ja": "ja",
    "fr": "fr-fr",
    "es": "es",
    "de": "de",
    "it": "it",
    "pt": "pt-br",
    "hi": "hi",
}


def _phonemes_to_tokens(phonemes: str, vocab: dict[str, int]) -> list[int]:
    tokens = []
    for ch in phonemes:
        if ch in vocab:
            tokens.append(vocab[ch])
    return tokens


def _split_text(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?;])\s+", text.strip())
    return [c for c in chunks if c.strip()]


class _EspeakG2P:
    def __init__(self, language: str):
        self._language = language

    def __call__(self, text: str) -> tuple[str, list]:
        result = subprocess.run(
            ["espeak-ng", "--ipa", "-q", "-v", self._language, text],
            capture_output=True,
            text=True,
            timeout=10,
        )
        phonemes = result.stdout.strip()
        phonemes = " ".join(phonemes.splitlines())
        return phonemes, []


class KokoroBackend(TTSBackend):
    name = "kokoro"
    handles_speed = True

    def __init__(self):
        self._session = None
        self._model_path: Path | None = None
        self._vocab: dict[str, int] = {}
        self._voices: dict[str, np.ndarray] = {}
        self._g2p = None
        self._g2p_lang: str | None = None

    def load_model(self, model_path: Path, device: str) -> None:
        import onnxruntime as ort

        logger.info(f"[kokoro] Loading model from {model_path} on {device}")
        self._model_path = model_path

        onnx_path = model_path / "onnx" / "model.onnx"
        if not onnx_path.exists():
            raise FileNotFoundError(f"ONNX model not found at {onnx_path}")

        providers = ["CPUExecutionProvider"]
        if device == "cuda":
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
                logger.info("[kokoro] Using CUDA execution provider")
            else:
                logger.warning(
                    "[kokoro] CUDA requested but not available, falling back to CPU"
                )

        self._session = ort.InferenceSession(str(onnx_path), providers=providers)

        config_path = model_path / "config.json"
        if config_path.exists():
            with open(config_path) as f:
                config = json.load(f)
            self._vocab = config.get("vocab", {})
            logger.info(f"[kokoro] Loaded vocab with {len(self._vocab)} tokens")
        else:
            raise FileNotFoundError(f"Config not found at {config_path}")

        voices_dir = model_path / "voices"
        if voices_dir.is_dir():
            for voice_file in voices_dir.glob("*.bin"):
                voice_name = voice_file.stem
                voice_data = np.fromfile(str(voice_file), dtype=np.float32)
                self._voices[voice_name] = voice_data.reshape(-1, 1, 256)
                logger.debug(f"[kokoro] Loaded voice: {voice_name}")
            logger.info(f"[kokoro] Loaded {len(self._voices)} voices")
        else:
            logger.warning(f"[kokoro] No voices directory found at {voices_dir}")

    def unload_model(self) -> None:
        logger.info("[kokoro] Unloading model")
        self._session = None
        self._model_path = None
        self._vocab = {}
        self._voices = {}
        self._g2p = None
        self._g2p_lang = None

    def is_loaded(self) -> bool:
        return self._session is not None

    @property
    def sample_rate(self) -> int:
        return SAMPLE_RATE

    @staticmethod
    def _ensure_spacy_model(name: str = "en_core_web_sm") -> None:
        import spacy.util

        if spacy.util.is_package(name):
            return
        logger.info(f"[kokoro] Spacy model '{name}' not found, downloading...")
        subprocess.check_call(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--break-system-packages",
                f"{name}@https://github.com/explosion/spacy-models/releases/download/{name}-3.8.0/{name}-3.8.0-py3-none-any.whl",
            ],
            stdout=subprocess.DEVNULL,
        )

    def _get_g2p(self, language: str):
        lang = language.lower().split("-")[0] if language else "en"

        if self._g2p is not None and self._g2p_lang == lang:
            return self._g2p

        if lang in _MISAKI_LANGUAGES:
            if lang == "en":
                self._ensure_spacy_model("en_core_web_sm")
                from misaki import en

                self._g2p = en.G2P()
            elif lang == "zh":
                from misaki import zh

                self._g2p = zh.G2P()
        elif lang in _ESPEAK_LANG_MAP:
            self._g2p = _EspeakG2P(_ESPEAK_LANG_MAP[lang])
            logger.info(f"[kokoro] Using espeak-ng for language '{lang}'")
        else:
            self._ensure_spacy_model("en_core_web_sm")
            from misaki import en

            logger.warning(
                f"[kokoro] Language '{lang}' not supported, falling back to English G2P"
            )
            self._g2p = en.G2P()
            lang = "en"

        self._g2p_lang = lang
        return self._g2p

    def _resolve_voice(self, voice_path: str | None, language: str) -> np.ndarray:
        if not self._voices:
            raise RuntimeError("No voices loaded")

        if voice_path:
            voice_name = voice_path.replace(".bin", "").split("/")[-1]
            if voice_name in self._voices:
                return self._voices[voice_name]
            logger.warning(f"[kokoro] Voice '{voice_name}' not found, using default")

        lang_key = language.lower()
        default_name = DEFAULT_VOICES.get(lang_key) or DEFAULT_VOICES.get(
            lang_key.split("-")[0], "af_heart"
        )

        if default_name in self._voices:
            return self._voices[default_name]

        first_name = next(iter(self._voices))
        logger.warning(
            f"[kokoro] Default voice '{default_name}' not found, using '{first_name}'"
        )
        return self._voices[first_name]

    def _run_inference(
        self, tokens: list[int], voice: np.ndarray, speed: float
    ) -> np.ndarray:
        input_ids = np.array([[0, *tokens, 0]], dtype=np.int64)

        idx = min(len(tokens), voice.shape[0] - 1)
        style = voice[idx]

        speed_arr = np.array([speed], dtype=np.float32)

        input_names = [inp.name for inp in self._session.get_inputs()]

        inputs = {}
        if "input_ids" in input_names:
            inputs["input_ids"] = input_ids
        elif "tokens" in input_names:
            inputs["tokens"] = input_ids
        else:
            inputs[input_names[0]] = input_ids

        inputs["style"] = style
        inputs["speed"] = speed_arr

        result = self._session.run(None, inputs)
        return result[0]

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("Kokoro model not loaded")

        logger.info(f"[kokoro] Generating: {params.text[:80]}...")

        g2p = self._get_g2p(params.language)
        voice = self._resolve_voice(params.voice_path, params.language)

        text_chunks = _split_text(params.text)
        if not text_chunks:
            text_chunks = [params.text]

        audio_parts: list[np.ndarray] = []

        for chunk_text in text_chunks:
            phonemes, _ = g2p(chunk_text)
            if not phonemes:
                continue

            tokens = _phonemes_to_tokens(phonemes, self._vocab)
            if not tokens:
                continue

            for i in range(0, len(tokens), MAX_PHONEME_LENGTH):
                token_chunk = tokens[i : i + MAX_PHONEME_LENGTH]
                audio = self._run_inference(token_chunk, voice, params.speed)

                audio = np.asarray(audio, dtype=np.float32).flatten()
                audio_parts.append(audio)

        if not audio_parts:
            return TTSResult(
                audio=np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32),
                sample_rate=SAMPLE_RATE,
            )

        full_audio = np.concatenate(audio_parts)

        logger.info(f"[kokoro] Generated {len(full_audio) / SAMPLE_RATE:.2f}s of audio")
        return TTSResult(audio=full_audio, sample_rate=SAMPLE_RATE)
