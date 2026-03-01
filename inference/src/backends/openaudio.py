import logging
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)


def _load_dac_codec(codec_path: str, device: str):
    """Load the DAC codec model from config + weights, bypassing pyrootutils."""
    import torch
    from omegaconf import OmegaConf
    from hydra.utils import instantiate

    import fish_speech

    pkg_dir = Path(fish_speech.__file__).parent
    cfg_file = pkg_dir / "configs" / "modded_dac_vq.yaml"

    if not cfg_file.exists():
        raise FileNotFoundError(f"DAC config not found at {cfg_file}")

    cfg = OmegaConf.load(str(cfg_file))
    OmegaConf.register_new_resolver("eval", eval, replace=True)
    model = instantiate(cfg)

    state_dict = torch.load(codec_path, map_location=device, weights_only=True)

    if "state_dict" in state_dict:
        state_dict = state_dict["state_dict"]

    # Strip "generator." prefix if present
    if any("generator" in k for k in state_dict):
        state_dict = {
            k.replace("generator.", ""): v
            for k, v in state_dict.items()
            if "generator." in k
        }

    model.load_state_dict(state_dict, strict=False, assign=True)
    model.eval()
    model.to(device)

    logger.info(f"[openaudio] DAC codec loaded (sample_rate={model.sample_rate})")
    return model


class OpenAudioBackend(TTSBackend):
    name = "openaudio"

    def __init__(self):
        super().__init__()
        self._decode_one_token = None
        self._codec = None
        self._sample_rate = 44100

    def load_model(self, model_path: Path, device: str) -> None:
        import torch
        from fish_speech.models.text2semantic.inference import init_model

        logger.info(f"[openaudio] Loading model from {model_path} on {device}")

        resolved_device = self._resolve_device(device)

        # Pick precision: bfloat16 on CUDA, float32 on CPU
        precision = torch.bfloat16 if resolved_device != "cpu" else torch.float32

        # Stage 1: Load the DualARTransformer (LLM) via init_model
        # init_model loads model weights + tokenizer from checkpoint_path
        self._model, self._decode_one_token = init_model(
            checkpoint_path=str(model_path),
            device=resolved_device,
            precision=precision,
            compile=False,
        )

        # Stage 2: Load the DAC codec for audio encode/decode
        codec_path = model_path / "codec.pth"
        if not codec_path.exists():
            raise FileNotFoundError(
                f"Codec weights not found at {codec_path}"
            )
        self._codec = _load_dac_codec(str(codec_path), resolved_device)
        self._sample_rate = self._codec.sample_rate

        self._model_path = model_path
        self._device = resolved_device
        logger.info(f"[openaudio] Model loaded on {resolved_device}")

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
        """Encode reference audio into VQ tokens for voice cloning."""
        import torch
        import torchaudio

        logger.info(f"[openaudio] Encoding reference audio: {audio_path}")

        audio, sr = torchaudio.load(audio_path)

        # Convert to mono
        if audio.shape[0] > 1:
            audio = audio.mean(0, keepdim=True)

        # Resample to codec sample rate if needed
        if sr != self._sample_rate:
            resampler = torchaudio.transforms.Resample(sr, self._sample_rate)
            audio = resampler(audio)

        # Encode: [1, 1, T] -> [1, num_codebooks, num_features]
        audios = audio[None].to(self._device)
        audio_lengths = torch.tensor(
            [audios.shape[2]], device=self._device, dtype=torch.long
        )

        with torch.no_grad():
            indices, _ = self._codec.encode(audios, audio_lengths)

        # Remove batch dim -> [num_codebooks, num_features]
        prompt_tokens = indices[0]
        logger.info(
            f"[openaudio] Reference encoded: {prompt_tokens.shape}"
        )
        return prompt_tokens

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("OpenAudio model not loaded")

        import torch
        from fish_speech.models.text2semantic.inference import generate_long

        logger.info(f"[openaudio] Generating: {params.text[:80]}...")

        prompt_tokens = None

        # Encode reference audio for voice cloning
        if params.has_reference_audio:
            with self._reference_audio(params) as ref_audio_path:
                from ..services.prompt_cache import get_cache

                cache = get_cache()
                prompt_key = cache.prompt_cache_key(ref_audio_path, self.name)
                cached = cache.get_prompt(prompt_key)

                if cached is not None:
                    logger.info("[openaudio] L2 cache hit for prompt tokens")
                    prompt_tokens = cached.to(self._device)
                else:
                    prompt_tokens = self._encode_reference(ref_audio_path)
                    cache.put_prompt(prompt_key, prompt_tokens.cpu())
                    logger.info("[openaudio] Reference encoded and cached")

        # Stage 1: Text -> semantic tokens via LLM
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
        logger.info(f"[openaudio] Generated {codes.shape[1]} semantic tokens")

        # Stage 2: Semantic tokens -> audio via DAC codec
        feature_lengths = torch.tensor(
            [codes.shape[1]], device=self._device, dtype=torch.long
        )
        with torch.no_grad():
            audio_hat, _ = self._codec.decode(
                codes[None].to(self._device), feature_lengths
            )

        # audio_hat shape: [1, 1, num_samples]
        audio = audio_hat[0, 0].float().cpu().numpy()
        audio = self._normalize_audio(audio)

        logger.info(
            f"[openaudio] Generated {len(audio) / self._sample_rate:.2f}s "
            f"of audio at {self._sample_rate}Hz"
        )
        return TTSResult(audio=audio, sample_rate=self._sample_rate)
