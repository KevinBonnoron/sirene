import logging
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)

SAMPLE_RATE = 24000

DEFAULT_SYSTEM_PROMPT = (
    "Generate audio following instruction.\n\n"
    "<|scene_desc_start|>\n"
    "Audio is recorded from a quiet room.\n"
    "<|scene_desc_end|>"
)


class HiggsAudioBackend(TTSBackend):
    name = "higgs_audio"

    def __init__(self):
        super().__init__()
        self._audio_tokenizer = None
        self._model_client = None
        self._sample_rate = SAMPLE_RATE

    def load_model(self, model_path: Path, device: str) -> None:
        import torch
        from boson_multimodal.audio_processing.higgs_audio_tokenizer import (
            load_higgs_audio_tokenizer,
        )

        logger.info(f"[higgs_audio] Loading model from {model_path} on {device}")

        resolved_device = self._resolve_device(device)

        # Load the audio tokenizer from the tokenizer/ subdirectory
        tokenizer_path = model_path / "tokenizer"
        # For MPS, use CPU due to embedding operation limitations
        tokenizer_device = "cpu" if resolved_device == "mps" else resolved_device
        self._audio_tokenizer = load_higgs_audio_tokenizer(
            str(tokenizer_path), device=tokenizer_device
        )

        # Import and create the model client
        # We import generation.py's HiggsAudioModelClient for direct inference
        from boson_multimodal.model.higgs_audio import HiggsAudioModel
        from transformers import AutoConfig, AutoTokenizer
        from boson_multimodal.data_collator.higgs_audio_collator import (
            HiggsAudioSampleCollator,
        )

        # Load model with bfloat16 on CUDA, float32 on CPU
        self._model = HiggsAudioModel.from_pretrained(
            str(model_path),
            device_map=resolved_device,
            torch_dtype=torch.bfloat16 if resolved_device != "cpu" else torch.float32,
        )
        self._model.eval()

        self._tokenizer = AutoTokenizer.from_pretrained(str(model_path))
        self._config = AutoConfig.from_pretrained(str(model_path))

        self._collator = HiggsAudioSampleCollator(
            whisper_processor=None,
            audio_in_token_id=self._config.audio_in_token_idx,
            audio_out_token_id=self._config.audio_out_token_idx,
            audio_stream_bos_id=self._config.audio_stream_bos_id,
            audio_stream_eos_id=self._config.audio_stream_eos_id,
            encode_whisper_embed=self._config.encode_whisper_embed,
            pad_token_id=self._config.pad_token_id,
            return_audio_in_tokens=self._config.encode_audio_in_tokens,
            use_delay_pattern=self._config.use_delay_pattern,
            round_to=1,
            audio_num_codebooks=self._config.audio_num_codebooks,
        )

        self._model_path = model_path
        self._device = resolved_device
        logger.info(f"[higgs_audio] Model loaded on {resolved_device}")

    def unload_model(self) -> None:
        if self._audio_tokenizer is not None:
            del self._audio_tokenizer
            self._audio_tokenizer = None
        self._model_client = None
        self._tokenizer = None
        self._config = None
        self._collator = None
        super().unload_model()

    def is_loaded(self) -> bool:
        return self._model is not None and self._audio_tokenizer is not None

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("Higgs Audio model not loaded")

        import torch
        from dataclasses import asdict
        from boson_multimodal.data_types import Message, ChatMLSample, AudioContent
        from boson_multimodal.dataset.chatml_dataset import (
            ChatMLDatasetSample,
            prepare_chatml_sample,
        )
        from boson_multimodal.model.higgs_audio.utils import revert_delay_pattern

        logger.info(f"[higgs_audio] Generating: {params.text[:80]}...")

        messages = []
        audio_ids = []

        # System message
        messages.append(Message(role="system", content=DEFAULT_SYSTEM_PROMPT))

        # Voice cloning: add reference audio as context
        if params.reference_audio:
            with self._reference_audio(params.reference_audio) as ref_audio_path:
                ref_tokens = self._audio_tokenizer.encode(ref_audio_path)
                audio_ids.append(ref_tokens)

                # Add reference transcript as user message + audio as assistant response
                ref_text = params.joined_reference_text or ""
                messages.append(Message(role="user", content=ref_text))
                messages.append(
                    Message(
                        role="assistant",
                        content=AudioContent(audio_url=ref_audio_path),
                    )
                )

        # Prepare generation
        text = params.text.strip()
        if not any(text.endswith(c) for c in [".", "!", "?", ",", ";", '"', "'"]):
            text += "."

        # Build input tokens
        generation_messages = [Message(role="user", content=text)]
        chatml_sample = ChatMLSample(messages=messages + generation_messages)
        input_tokens, _, _, _ = prepare_chatml_sample(
            chatml_sample, self._tokenizer
        )
        postfix = self._tokenizer.encode(
            "<|start_header_id|>assistant<|end_header_id|>\n\n",
            add_special_tokens=False,
        )
        input_tokens.extend(postfix)

        # Prepare dataset sample
        curr_sample = ChatMLDatasetSample(
            input_ids=torch.LongTensor(input_tokens),
            label_ids=None,
            audio_ids_concat=torch.concat(
                [ele.cpu() for ele in audio_ids], dim=1
            )
            if audio_ids
            else None,
            audio_ids_start=torch.cumsum(
                torch.tensor(
                    [0] + [ele.shape[1] for ele in audio_ids], dtype=torch.long
                ),
                dim=0,
            )
            if audio_ids
            else None,
            audio_waveforms_concat=None,
            audio_waveforms_start=None,
            audio_sample_rate=None,
            audio_speaker_indices=None,
        )

        batch_data = self._collator([curr_sample])
        batch = asdict(batch_data)
        for k, v in batch.items():
            if isinstance(v, torch.Tensor):
                batch[k] = v.contiguous().to(self._device)

        # Generate
        with torch.inference_mode():
            outputs = self._model.generate(
                **batch,
                max_new_tokens=2048,
                use_cache=True,
                do_sample=True,
                temperature=1.0,
                top_k=50,
                top_p=0.95,
                stop_strings=["<|end_of_text|>", "<|eot_id|>"],
                tokenizer=self._tokenizer,
            )

        # Extract audio tokens
        audio_out_ids_list = []
        for ele in outputs[1]:
            audio_out_ids = ele
            if self._config.use_delay_pattern:
                audio_out_ids = revert_delay_pattern(audio_out_ids)
            audio_out_ids_list.append(
                audio_out_ids.clip(0, self._audio_tokenizer.codebook_size - 1)[
                    :, 1:-1
                ]
            )

        if not audio_out_ids_list:
            raise RuntimeError("Higgs Audio generated no audio tokens")

        concat_audio_ids = torch.concat(audio_out_ids_list, dim=1)

        # Decode audio tokens to waveform
        if concat_audio_ids.device.type == "mps":
            concat_audio_ids = concat_audio_ids.detach().cpu()

        waveform = self._audio_tokenizer.decode(
            concat_audio_ids.unsqueeze(0)
        )[0, 0]

        # Convert to numpy
        if isinstance(waveform, torch.Tensor):
            audio = waveform.float().cpu().numpy()
        else:
            audio = np.asarray(waveform, dtype=np.float32)

        audio = self._normalize_audio(audio)

        logger.info(
            f"[higgs_audio] Generated {len(audio) / SAMPLE_RATE:.2f}s "
            f"of audio at {SAMPLE_RATE}Hz"
        )
        return TTSResult(audio=audio, sample_rate=SAMPLE_RATE)
