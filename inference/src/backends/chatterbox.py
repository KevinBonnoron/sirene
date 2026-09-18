import logging
from pathlib import Path

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)


class ChatterboxBackend(TTSBackend):
    name = "chatterbox"

    def __init__(self):
        super().__init__()
        self._is_multilingual: bool = False

    def load_model(self, model_path: Path, device: str) -> None:
        import torch

        logger.info(f"[chatterbox] Loading model from {model_path} on {device}")

        resolved_device = self._resolve_device(device)

        self._is_multilingual = (model_path / "t3_mtl23ls_v2.safetensors").exists()

        # Multilingual from_local omits map_location in torch.load, so CUDA-saved .pt files fail on CPU.
        if resolved_device == "cpu":
            _orig_load = torch.load
            torch.load = lambda *a, **kw: _orig_load(
                *a, **{**kw, "map_location": torch.device("cpu")}
            )

        try:
            if self._is_multilingual:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS

                logger.info("[chatterbox] Loading multilingual model")
                self._model = ChatterboxMultilingualTTS.from_local(
                    model_path, resolved_device
                )
            else:
                from chatterbox.tts import ChatterboxTTS

                logger.info("[chatterbox] Loading English model")
                self._model = ChatterboxTTS.from_local(
                    model_path, resolved_device
                )
        finally:
            if resolved_device == "cpu":
                torch.load = _orig_load

        # Eager attention avoids the SDPA / output_attentions conflict.
        import torch.nn as nn

        for attr in vars(self._model).values():
            if isinstance(attr, nn.Module):
                for module in attr.modules():
                    cfg = getattr(module, "config", None)
                    if cfg is not None and getattr(cfg, "_attn_implementation", None) == "sdpa":
                        cfg._attn_implementation = "eager"

        self._model_path = model_path
        self._device = resolved_device
        self._sample_rate = self._model.sr
        logger.info(
            f"[chatterbox] Model loaded on {resolved_device} "
            f"(multilingual={self._is_multilingual}, sr={self._sample_rate})"
        )

    # The library exposes no incremental decode, so nothing overrides generate_stream and the
    # base one renders the whole take before yielding. Saying so routes the request through
    # the keepalive path, which at least holds the connection open while that happens.
    def supports_streaming(self) -> bool:
        return False

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("Chatterbox model not loaded")

        logger.info(f"[chatterbox] Generating: {params.text[:80]}...")

        if not params.has_reference_audio:
            raise ValueError(
                "Chatterbox requires reference_audio for voice cloning. "
                "Provide a URL to a reference audio file."
            )

        with self._reference_audio(params) as ref_audio_path:
            if self._is_multilingual:
                wav = self._model.generate(
                    params.text,
                    audio_prompt_path=ref_audio_path,
                    language_id=params.language,
                )
            else:
                wav = self._model.generate(
                    params.text,
                    audio_prompt_path=ref_audio_path,
                )

            audio = wav.squeeze().float().cpu().numpy()
            audio = self._normalize_audio(audio)

            sr = self._model.sr
            logger.info(
                f"[chatterbox] Generated {len(audio) / sr:.2f}s of audio at {sr}Hz"
            )
            return TTSResult(audio=audio, sample_rate=sr)
