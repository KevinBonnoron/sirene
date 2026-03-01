import logging
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)


class F5TTSBackend(TTSBackend):
    name = "f5tts"

    def load_model(self, model_path: Path, device: str) -> None:
        from f5_tts.api import F5TTS

        logger.info(f"[f5tts] Loading model from {model_path} on {device}")

        resolved_device = self._resolve_device(device)

        base_dir = model_path / "F5TTS_v1_Base"
        ckpt_file = base_dir / "model_1250000.safetensors"
        vocab_file = base_dir / "vocab.txt"

        if not ckpt_file.exists():
            raise FileNotFoundError(
                f"F5-TTS checkpoint not found at {ckpt_file}. "
                f"Expected model files in {base_dir}/"
            )
        if not vocab_file.exists():
            raise FileNotFoundError(
                f"F5-TTS vocab not found at {vocab_file}. "
                f"Expected vocab.txt in {base_dir}/"
            )

        self._model = F5TTS(
            model="F5TTS_v1_Base",
            ckpt_file=str(ckpt_file),
            vocab_file=str(vocab_file),
            device=resolved_device,
        )
        self._model_path = model_path
        self._device = resolved_device
        logger.info(f"[f5tts] Model loaded on {resolved_device}")

    def supports_streaming(self) -> bool:
        return False

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("F5-TTS model not loaded")

        logger.info(f"[f5tts] Generating: {params.text[:80]}...")

        if not params.has_reference_audio:
            raise ValueError(
                "F5-TTS requires reference_audio for voice cloning. "
                "Provide a URL to a reference audio file."
            )

        with self._reference_audio(params) as ref_audio_path:
            ref_text = params.joined_reference_text

            if not ref_text:
                logger.warning(
                    "[f5tts] No reference_text provided. "
                    "F5-TTS works best with a transcript of the reference "
                    "audio. Proceeding with empty reference text."
                )

            wav, sr, _spec = self._model.infer(
                ref_file=ref_audio_path,
                ref_text=ref_text,
                gen_text=params.text,
                speed=params.speed,
            )

            if hasattr(wav, 'cpu'):
                audio = wav.squeeze().cpu().numpy().astype(np.float32)
            else:
                audio = np.asarray(wav, dtype=np.float32).squeeze()
            self._sample_rate = sr
            audio = self._normalize_audio(audio)

            return TTSResult(audio=audio, sample_rate=sr)
