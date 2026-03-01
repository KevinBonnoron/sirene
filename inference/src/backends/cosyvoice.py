import logging
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)


_mask_patched = False


def _patch_qwen2_attention_mask():
    """Fix CosyVoice's Qwen2Encoder.forward_one_step attention mask for CPU.

    The upstream code passes an attention_mask of shape (batch, 1) during
    autoregressive decoding with KV cache.  HuggingFace Qwen2 expects
    (batch, past_len + current_len).  On GPU with SDPA/Flash Attention this
    is silently handled, but on CPU (eager attention) it causes the model to
    ignore all cached context, producing garbage output.
    """
    global _mask_patched
    if _mask_patched:
        return
    try:
        import torch
        from cosyvoice.llm.llm import Qwen2Encoder

        original = Qwen2Encoder.forward_one_step

        def _fixed_forward_one_step(self, xs, masks, cache=None):
            if cache is not None:
                past_len = cache[0][0].shape[2]
                current_len = xs.shape[1]
                input_masks = torch.ones(
                    xs.shape[0], past_len + current_len,
                    device=xs.device, dtype=torch.long,
                )
            else:
                input_masks = masks[:, -1, :]

            outs = self.model(
                inputs_embeds=xs,
                attention_mask=input_masks,
                output_hidden_states=True,
                return_dict=True,
                use_cache=True,
                past_key_values=cache,
            )
            xs = outs.hidden_states[-1]
            new_cache = outs.past_key_values
            return xs, new_cache

        Qwen2Encoder.forward_one_step = _fixed_forward_one_step
        _mask_patched = True
        logger.info("[cosyvoice] Patched Qwen2Encoder attention mask for CPU")
    except Exception:
        logger.warning("[cosyvoice] Could not patch Qwen2Encoder", exc_info=True)


class CosyVoiceBackend(TTSBackend):
    name = "cosyvoice"

    def __init__(self):
        super().__init__()
        self._sample_rate = 22050

    @property
    def max_reference_duration(self) -> float:
        return 20.0

    def load_model(self, model_path: Path, device: str) -> None:
        _patch_qwen2_attention_mask()

        from cosyvoice.cli.cosyvoice import AutoModel

        logger.info(f"[cosyvoice] Loading model from {model_path}")

        # CosyVoice handles device selection internally (auto-detects CUDA).
        self._model = AutoModel(model_dir=str(model_path))
        self._sample_rate = self._model.sample_rate
        self._model_path = model_path
        self._device = device
        logger.info(
            f"[cosyvoice] Model loaded (sample_rate={self._sample_rate})"
        )

    def supports_streaming(self) -> bool:
        return True

    def _collect_audio(self, generator) -> np.ndarray:
        """Collect all audio chunks from a CosyVoice generator into one array."""
        chunks = []
        for result in generator:
            speech = result.get("tts_speech")
            if speech is not None:
                audio = speech.cpu().numpy().squeeze()
                chunks.append(audio)

        if not chunks:
            raise RuntimeError("CosyVoice generated no audio")
        return np.concatenate(chunks).astype(np.float32)

    def _reset_model_state(self):
        """Reset mutable model state between inference calls.

        CosyVoice's model keeps instance-level variables (token_hop_len,
        internal dicts) that can leak between sequential calls. Explicitly
        resetting them avoids subtle regeneration bugs.
        """
        model = self._model.model  # underlying CosyVoice2Model/3Model
        model.token_hop_len = 25
        model.tts_speech_token_dict.clear()
        model.llm_end_dict.clear()
        model.hift_cache_dict.clear()
        if hasattr(model, "flow_cache_dict"):
            model.flow_cache_dict.clear()
        if hasattr(model, "mel_overlap_dict"):
            model.mel_overlap_dict.clear()
        # Clear vLLM queue if present
        if hasattr(model.llm, "vllm_output_queue"):
            model.llm.vllm_output_queue.clear()

        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _infer_instruct(
        self, params: GenerateParams, ref_audio_path: str | None, *, stream: bool = False,
    ):
        """Run instruct mode inference (CosyVoice2/3 only)."""
        if not hasattr(self._model, "inference_instruct2"):
            raise ValueError(
                "Instruct mode (voice design) requires CosyVoice2 or CosyVoice3. "
                "The currently loaded model does not support inference_instruct2."
            )

        if ref_audio_path is None:
            gender = params.instruct_gender or "male"
            lang = params.language or "en"
            seed_name = f"seed_{lang}_{gender}.wav"
            seed_path = Path(__file__).parent.parent / "assets" / seed_name
            if not seed_path.exists():
                seed_path = Path(__file__).parent.parent / "assets" / f"seed_en_{gender}.wav"
            ref_audio_path = str(seed_path)

        instruct_text = params.instruct_text
        # CosyVoice3 requires <|endofprompt|> in the instruct text.
        if "<|endofprompt|>" not in instruct_text:
            instruct_text = instruct_text.rstrip() + "<|endofprompt|>"

        logger.info(
            f"[cosyvoice] instruct mode: instruct='{instruct_text[:80]}', "
            f"text='{params.text[:80]}', ref='{ref_audio_path}', stream={stream}"
        )
        return self._model.inference_instruct2(
            params.text, instruct_text, ref_audio_path, stream=stream,
        )

    def _infer(
        self, params: GenerateParams, ref_audio_path: str, ref_text: str, *, stream: bool = False,
    ):
        """Run zero-shot inference (requires reference audio + transcript)."""
        if not ref_text:
            raise ValueError(
                "CosyVoice requires reference_text (a transcript of the "
                "reference audio) for zero-shot voice cloning."
            )

        # CosyVoice3 requires the <|endofprompt|> token in the prompt text.
        if "<|endofprompt|>" not in ref_text:
            ref_text = ref_text.rstrip() + "<|endofprompt|>"

        logger.info(f"[cosyvoice] zero-shot ({ref_text[:50]}...), stream={stream}")
        return self._model.inference_zero_shot(
            params.text, ref_text, ref_audio_path, stream=stream,
        )

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("CosyVoice model not loaded")

        logger.info(f"[cosyvoice] Generating: {params.text[:80]}...")
        self._reset_model_state()

        if params.instruct_text:
            if params.reference_audio:
                with self._reference_audio(params.reference_audio) as ref_audio_path:
                    gen = self._infer_instruct(params, ref_audio_path)
                    audio = self._collect_audio(gen)
            else:
                gen = self._infer_instruct(params, None)
                audio = self._collect_audio(gen)
        else:
            if not params.reference_audio:
                raise ValueError(
                    "CosyVoice requires reference_audio for voice cloning. "
                    "Provide a voice with at least one audio sample."
                )
            with self._reference_audio(params.reference_audio) as ref_audio_path:
                ref_text = params.joined_reference_text
                gen = self._infer(params, ref_audio_path, ref_text)
                audio = self._collect_audio(gen)

        audio = self._normalize_audio(audio)
        logger.info(
            f"[cosyvoice] Generated {len(audio) / self._sample_rate:.2f}s "
            f"of audio at {self._sample_rate}Hz"
        )
        return TTSResult(audio=audio, sample_rate=self._sample_rate)

    def generate_stream(self, params: GenerateParams):
        if not self.is_loaded():
            raise RuntimeError("CosyVoice model not loaded")

        logger.info(f"[cosyvoice] Streaming: {params.text[:80]}...")
        self._reset_model_state()

        if params.instruct_text:
            if params.reference_audio:
                with self._reference_audio(params.reference_audio) as ref_audio_path:
                    yield from self._stream_with_fallback(params, ref_audio_path, instruct=True)
            else:
                yield from self._stream_with_fallback(params, None, instruct=True)
        else:
            if not params.reference_audio:
                raise ValueError(
                    "CosyVoice requires reference_audio for voice cloning. "
                    "Provide a voice with at least one audio sample."
                )
            with self._reference_audio(params.reference_audio) as ref_audio_path:
                yield from self._stream_with_fallback(params, ref_audio_path, instruct=False)

    def _stream_with_fallback(self, params: GenerateParams, ref_audio_path: str | None, *, instruct: bool):
        """Stream audio chunks, falling back to non-streaming on vocoder error."""
        has_audio = False
        try:
            if instruct:
                gen = self._infer_instruct(params, ref_audio_path, stream=True)
            else:
                ref_text = params.joined_reference_text
                gen = self._infer(params, ref_audio_path, ref_text, stream=True)

            for result in gen:
                speech = result.get("tts_speech")
                if speech is not None:
                    audio = speech.cpu().numpy().squeeze().astype(np.float32)
                    audio = self._normalize_audio(audio)
                    has_audio = True
                    yield TTSResult(audio=audio, sample_rate=self._sample_rate)
        except RuntimeError as e:
            if "Kernel size can't be greater than actual input size" in str(e):
                logger.warning(
                    "[cosyvoice] Vocoder kernel error (input too short), "
                    "falling back to non-streaming generation"
                )
                self._reset_model_state()
                if instruct:
                    gen2 = self._infer_instruct(params, ref_audio_path, stream=False)
                else:
                    ref_text = params.joined_reference_text
                    gen2 = self._infer(params, ref_audio_path, ref_text, stream=False)
                audio = self._collect_audio(gen2)
                audio = self._normalize_audio(audio)
                yield TTSResult(audio=audio, sample_rate=self._sample_rate)
                has_audio = True
            else:
                raise

        if not has_audio:
            raise RuntimeError("CosyVoice generated no audio")
