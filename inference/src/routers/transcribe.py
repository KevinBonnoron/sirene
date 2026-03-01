import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, UploadFile

router = APIRouter(tags=["transcribe"])
logger = logging.getLogger(__name__)

_model = None
_model_id: str | None = None


def _get_model(model_path: str):
    global _model, _model_id

    if _model is not None and _model_id == model_path:
        return _model

    from faster_whisper import WhisperModel

    from ..config import settings

    device = settings.device
    compute_type = "float16" if device == "cuda" else "int8"

    if device == "cuda":
        try:
            import torch

            if not torch.cuda.is_available():
                raise RuntimeError("CUDA not available")
            # Verify the driver actually works
            torch.zeros(1, device="cuda")
        except Exception as e:
            logger.warning(f"CUDA requested but unavailable ({e}), falling back to CPU")
            device = "cpu"
            compute_type = "int8"

    logger.info(f"Loading Whisper model ({model_path}) on {device}")
    _model = WhisperModel(model_path, device=device, compute_type=compute_type)
    _model_id = model_path
    logger.info("Whisper model loaded")
    return _model


@router.post("/transcribe")
async def transcribe(audio: UploadFile, model_path: str = Form()):
    if audio.content_type and not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="File must be an audio file")

    with tempfile.NamedTemporaryFile(suffix=Path(audio.filename or "audio.wav").suffix, delete=True) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp.flush()

        try:
            model = _get_model(model_path)
            segments, info = model.transcribe(tmp.name, beam_size=5)
            text = " ".join(segment.text.strip() for segment in segments)
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return {"text": text, "language": info.language}
