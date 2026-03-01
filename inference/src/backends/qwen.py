import logging
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)

# Language code -> full name mapping required by qwen-tts API
LANGUAGE_MAP: dict[str, str] = {
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "it": "Italian",
}


class QwenBackend(TTSBackend):
    name = "qwen"

    @property
    def max_reference_duration(self) -> float:
        return 30.0

    def load_model(self, model_path: Path, device: str) -> None:
        import torch
        from qwen_tts import Qwen3TTSModel

        logger.info(f"[qwen] Loading model from {model_path} on {device}")

        device_map = self._resolve_device(device)
        dtype = torch.bfloat16 if device_map != "cpu" else torch.float32

        self._model = Qwen3TTSModel.from_pretrained(
            str(model_path),
            device_map=device_map,
            dtype=dtype,
        )
        self._model_path = model_path
        self._device = device
        logger.info(f"[qwen] Model loaded on {device_map}")

    def supports_streaming(self) -> bool:
        return True

    def _resolve_language(self, language: str) -> str:
        lang_key = language.lower().split("-")[0]
        full_name = LANGUAGE_MAP.get(lang_key)
        if full_name is None:
            logger.warning(f"[qwen] Language '{language}' not supported, falling back to English")
            return "English"
        return full_name

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("Qwen model not loaded")

        logger.info(f"[qwen] Generating: {params.text[:80]}...")

        language = self._resolve_language(params.language)

        if params.voice_path:
            # CustomVoice preset mode — select a pre-trained speaker
            logger.info(f"[qwen] CustomVoice mode: speaker={params.voice_path}")
            wavs, sr = self._model.generate_custom_voice(
                text=params.text,
                language=language,
                speaker=params.voice_path,
                instruct=params.instruct_text or None,
            )
        elif params.instruct_text and not params.reference_audio:
            # VoiceDesign mode — create voice from text description
            gender = params.instruct_gender or "male"
            logger.info(f"[qwen] VoiceDesign mode: gender={gender}, instruct={params.instruct_text[:80]}")
            wavs, sr = self._model.generate_voice_design(
                text=params.text,
                language=language,
                instruct=params.instruct_text,
                gender=gender,
            )
        elif params.reference_audio:
            # Voice cloning mode — use reference audio
            with self._reference_audio(params.reference_audio) as ref_audio_path:
                ref_text = params.joined_reference_text
                from ..services.prompt_cache import get_cache

                cache = get_cache()
                prompt_key = cache.prompt_cache_key(ref_audio_path, self.name, ref_text)
                prompt = cache.get_prompt(prompt_key)

                if prompt is not None:
                    logger.info("[qwen] L2 cache hit for voice clone prompt")
                else:
                    x_vector_only = not ref_text
                    prompt = self._model.create_voice_clone_prompt(
                        ref_audio=ref_audio_path,
                        ref_text=ref_text or None,
                        x_vector_only_mode=x_vector_only,
                    )
                    cache.put_prompt(prompt_key, prompt)
                    logger.info(f"[qwen] Voice clone prompt computed and cached (x_vector_only={x_vector_only})")

                wavs, sr = self._model.generate_voice_clone(
                    text=params.text,
                    language=language,
                    voice_clone_prompt=prompt,
                )
        else:
            logger.warning("[qwen] No reference audio — Qwen Base requires ref audio for cloning")
            wavs, sr = self._model.generate_voice_clone(
                text=params.text,
                language=language,
                ref_audio=None,
                ref_text=None,
            )

        audio = np.asarray(wavs[0], dtype=np.float32)
        self._sample_rate = sr
        audio = self._normalize_audio(audio)

        logger.info(f"[qwen] Generated {len(audio) / sr:.2f}s of audio at {sr}Hz")
        return TTSResult(audio=audio, sample_rate=sr)
