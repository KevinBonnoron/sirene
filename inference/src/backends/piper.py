import json
import logging
import subprocess
from pathlib import Path

import numpy as np

from .base import GenerateParams, TTSBackend, TTSResult

logger = logging.getLogger(__name__)

# Special phoneme tokens used by Piper models
_BOS = "^"
_EOS = "$"
_PAD = "_"


class PiperBackend(TTSBackend):
    name = "piper"

    def __init__(self):
        self._session = None
        self._model_path: Path | None = None
        self._sample_rate: int = 22050
        self._phoneme_id_map: dict[str, list[int]] = {}
        self._espeak_voice: str = "en-us"
        self._noise_scale: float = 0.667
        self._length_scale: float = 1.0
        self._noise_w: float = 0.8
        self._num_speakers: int = 1
        self._speaker_id_map: dict[str, int] = {}

    def load_model(self, model_path: Path, device: str) -> None:
        import onnxruntime as ort

        logger.info(f"[piper] Loading model from {model_path} on {device}")
        self._model_path = model_path

        # Find .onnx file (may be in subdirectories, e.g. fr/fr_FR/siwis/medium/)
        onnx_files = list(model_path.rglob("*.onnx"))
        if not onnx_files:
            raise FileNotFoundError(f"No .onnx file found in {model_path}")
        onnx_path = onnx_files[0]

        # Load config from .onnx.json
        config_path = Path(f"{onnx_path}.json")
        if not config_path.exists():
            raise FileNotFoundError(f"Config not found at {config_path}")

        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)

        self._sample_rate = config.get("audio", {}).get("sample_rate", 22050)
        self._phoneme_id_map = config.get("phoneme_id_map", {})
        self._espeak_voice = config.get("espeak", {}).get("voice", "en-us")
        inference = config.get("inference", {})
        self._noise_scale = inference.get("noise_scale", 0.667)
        self._length_scale = inference.get("length_scale", 1.0)
        self._noise_w = inference.get("noise_w", 0.8)
        self._num_speakers = config.get("num_speakers", 1)
        self._speaker_id_map = config.get("speaker_id_map", {})

        logger.info(
            f"[piper] Config: sample_rate={self._sample_rate}, "
            f"espeak_voice={self._espeak_voice}, "
            f"phonemes={len(self._phoneme_id_map)}, "
            f"speakers={self._num_speakers}"
        )

        # Create ONNX session
        providers = ["CPUExecutionProvider"]
        if device == "cuda":
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
                logger.info("[piper] Using CUDA execution provider")
            else:
                logger.warning("[piper] CUDA requested but not available, falling back to CPU")

        self._session = ort.InferenceSession(str(onnx_path), providers=providers)
        logger.info(f"[piper] Model loaded: {onnx_path.name}")

    def unload_model(self) -> None:
        logger.info("[piper] Unloading model")
        self._session = None
        self._model_path = None
        self._phoneme_id_map = {}

    def is_loaded(self) -> bool:
        return self._session is not None

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def _phonemize(self, text: str) -> list[list[str]]:
        """Convert text to phoneme sequences (one per sentence) via espeak-ng."""
        result = subprocess.run(
            ["espeak-ng", "--ipa", "-q", "-v", self._espeak_voice, text],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning(f"[piper] espeak-ng error: {result.stderr.strip()}")

        output = result.stdout.strip()
        if not output:
            return []

        # Each line from espeak-ng is a clause/sentence
        sentences: list[list[str]] = []
        for line in output.splitlines():
            line = line.strip()
            if line:
                sentences.append(list(line))
        return sentences

    def _phonemes_to_ids(self, phonemes: list[str]) -> list[int]:
        """Convert a list of phoneme characters to token IDs using the model's phoneme_id_map."""
        id_map = self._phoneme_id_map
        ids: list[int] = []

        # BOS
        if _BOS in id_map:
            ids.extend(id_map[_BOS])

        for phoneme in phonemes:
            if phoneme not in id_map:
                logger.debug(f"[piper] Skipping unknown phoneme: {phoneme!r}")
                continue
            ids.extend(id_map[phoneme])
            # PAD between phonemes
            if _PAD in id_map:
                ids.extend(id_map[_PAD])

        # EOS
        if _EOS in id_map:
            ids.extend(id_map[_EOS])

        return ids

    def _generate(self, params: GenerateParams) -> TTSResult:
        if not self.is_loaded():
            raise RuntimeError("Piper model not loaded")

        logger.info(f"[piper] Generating: {params.text[:80]}...")

        # Phonemize text into sentences
        sentence_phonemes = self._phonemize(params.text)
        if not sentence_phonemes:
            return TTSResult(
                audio=np.zeros(int(self._sample_rate * 0.5), dtype=np.float32),
                sample_rate=self._sample_rate,
            )

        # Adjust length_scale for speed (higher speed = shorter length)
        length_scale = self._length_scale / params.speed

        scales = np.array(
            [self._noise_scale, length_scale, self._noise_w],
            dtype=np.float32,
        )

        # Resolve speaker ID for multi-speaker models
        speaker_id: int | None = None
        if self._num_speakers > 1:
            speaker_id = 0
            if params.voice_path and params.voice_path in self._speaker_id_map:
                speaker_id = self._speaker_id_map[params.voice_path]

        audio_parts: list[np.ndarray] = []

        for phonemes in sentence_phonemes:
            phoneme_ids = self._phonemes_to_ids(phonemes)
            if not phoneme_ids:
                continue

            # Build ONNX inputs
            phoneme_ids_array = np.expand_dims(
                np.array(phoneme_ids, dtype=np.int64), 0
            )
            phoneme_ids_lengths = np.array(
                [phoneme_ids_array.shape[1]], dtype=np.int64
            )

            args = {
                "input": phoneme_ids_array,
                "input_lengths": phoneme_ids_lengths,
                "scales": scales,
            }

            if speaker_id is not None:
                args["sid"] = np.array([speaker_id], dtype=np.int64)

            # Run inference
            result = self._session.run(None, args)
            audio = result[0].squeeze()
            audio = np.asarray(audio, dtype=np.float32)
            audio_parts.append(audio)

        if not audio_parts:
            return TTSResult(
                audio=np.zeros(int(self._sample_rate * 0.5), dtype=np.float32),
                sample_rate=self._sample_rate,
            )

        full_audio = np.concatenate(audio_parts)
        logger.info(f"[piper] Generated {len(full_audio) / self._sample_rate:.2f}s of audio")
        return TTSResult(audio=full_audio, sample_rate=self._sample_rate)
