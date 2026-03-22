import logging
from pathlib import Path

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)


class FishAudioBackend(TTSBackend):
    name = "fish_audio"

    def __init__(self):
        super().__init__()
        self._decode_one_token = None
        self._codec = None
        self._sample_rate = 44100

    def load_model(self, model_path: Path, device: str) -> None:
        import torch
        from fish_speech.models.text2semantic.inference import init_model, load_codec_model

        logger.info(f"[fish_audio] Loading model from {model_path} on {device}")

        resolved_device = self._resolve_device(device)
        precision = torch.bfloat16 if resolved_device != "cpu" else torch.float32

        self._model, self._decode_one_token = init_model(
            checkpoint_path=str(model_path),
            device=resolved_device,
            precision=precision,
            compile=False,
        )

        codec_path = model_path / "codec.pth"
        if not codec_path.exists():
            raise FileNotFoundError(f"Codec weights not found at {codec_path}")
        self._codec = load_codec_model(str(codec_path), resolved_device, precision)
        self._sample_rate = self._codec.sample_rate

        self._model_path = model_path
        self._device = resolved_device
        logger.info(f"[fish_audio] Model loaded on {resolved_device}")

    def unload_model(self) -> None:
        self._decode_one_token = None
        if self._codec is not None:
            del self._codec
            self._codec = None
        super().unload_model()

    def is_loaded(self) -> bool:
        return self._model is not None and self._codec is not None

    def supports_streaming(self) -> bool:
        return True

    def _encode_reference(self, audio_path: str):
        from fish_speech.models.text2semantic.inference import encode_audio

        logger.info(f"[fish_audio] Encoding reference audio: {audio_path}")
        prompt_tokens = encode_audio(audio_path, self._codec, self._device)
        logger.info(f"[fish_audio] Reference encoded: {prompt_tokens.shape}")
        return prompt_tokens

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("Fish Audio model not loaded")

        import torch
        from fish_speech.models.text2semantic.inference import decode_to_audio, generate_long

        logger.info(f"[fish_audio] Generating: {params.text[:80]}...")

        prompt_tokens = None

        if params.has_reference_audio:
            with self._reference_audio(params) as ref_audio_path:
                from ..services.prompt_cache import get_cache

                cache = get_cache()
                prompt_key = cache.prompt_cache_key(ref_audio_path, self.name)
                cached = cache.get_prompt(prompt_key)

                if cached is not None:
                    logger.info("[fish_audio] L2 cache hit for prompt tokens")
                    prompt_tokens = cached.to(self._device)
                else:
                    prompt_tokens = self._encode_reference(ref_audio_path)
                    cache.put_prompt(prompt_key, prompt_tokens.cpu())
                    logger.info("[fish_audio] Reference encoded and cached")

        codes_list = []
        for response in generate_long(
            model=self._model,
            device=self._device,
            decode_one_token=self._decode_one_token,
            text=params.text,
            prompt_text=params.joined_reference_text or None,
            prompt_tokens=prompt_tokens,
        ):
            if response.action == "sample" and response.codes is not None:
                codes_list.append(response.codes)
            elif response.action == "next":
                break

        if not codes_list:
            raise RuntimeError("OpenAudio LLM generated no tokens")

        codes = torch.cat(codes_list, dim=1)
        logger.info(f"[fish_audio] Generated {codes.shape[1]} semantic tokens")

        audio = decode_to_audio(codes, self._codec).float().cpu().numpy()
        audio = self._normalize_audio(audio)

        logger.info(
            f"[fish_audio] Generated {len(audio) / self._sample_rate:.2f}s "
            f"of audio at {self._sample_rate}Hz"
        )
        return TTSResult(audio=audio, sample_rate=self._sample_rate)
