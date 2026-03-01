import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from ..backends.base import GenerateParams
from ..schemas import GenerateRequest
from ..services.audio import pcm_to_raw_chunks, pcm_to_wav, stream_pcm_chunks
from ..services.model_manager import model_manager

logger = logging.getLogger(__name__)

router = APIRouter()


def _normalize_to_list(value: list[str] | str | None) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        return [value]
    return value


_POLL_INTERVAL = 0.1
_KEEPALIVE_INTERVAL = 15
_SILENT_CHUNK = b"\x00" * 256


async def _generate_with_keepalive(
    backend: str, model_path: str, params: GenerateParams
):
    """Run blocking generation in a thread, yielding silent PCM keepalive to prevent upstream timeouts."""
    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(
        None, model_manager.generate, backend, model_path, params
    )

    elapsed = 0.0
    while not future.done():
        await asyncio.sleep(_POLL_INTERVAL)
        elapsed += _POLL_INTERVAL
        if not future.done() and elapsed >= _KEEPALIVE_INTERVAL:
            yield _SILENT_CHUNK
            elapsed = 0.0

    result = future.result()
    for chunk in pcm_to_raw_chunks(result.audio):
        yield chunk


@router.post("/generate")
async def generate(req: GenerateRequest):
    params = GenerateParams(
        text=req.text,
        voice_path=req.voice_path,
        reference_audio=_normalize_to_list(req.reference_audio),
        reference_text=_normalize_to_list(req.reference_text),
        instruct_text=req.instruct_text,
        instruct_gender=req.instruct_gender,
        speed=req.speed,
        language=req.language,
    )

    try:
        result = model_manager.generate(req.backend, req.model_path, params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    wav_bytes = pcm_to_wav(result.audio, result.sample_rate)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=generation.wav"},
    )


@router.post("/generate/stream")
async def generate_stream(req: GenerateRequest):
    params = GenerateParams(
        text=req.text,
        voice_path=req.voice_path,
        reference_audio=_normalize_to_list(req.reference_audio),
        reference_text=_normalize_to_list(req.reference_text),
        instruct_text=req.instruct_text,
        instruct_gender=req.instruct_gender,
        speed=req.speed,
        language=req.language,
    )

    try:
        backend = model_manager.get_backend(req.backend, req.model_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    headers = {
        "X-Sample-Rate": str(backend.sample_rate),
        "X-Channels": "1",
        "X-Bits-Per-Sample": "16",
    }

    try:
        if backend.supports_streaming():
            gen = model_manager.generate_stream(
                req.backend, req.model_path, params
            )
            return StreamingResponse(
                stream_pcm_chunks(gen),
                media_type="audio/pcm",
                headers=headers,
            )

        return StreamingResponse(
            _generate_with_keepalive(req.backend, req.model_path, params),
            media_type="audio/pcm",
            headers=headers,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Streaming generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
