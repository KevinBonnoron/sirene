import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from ..backends.base import GenerateParams
from ..backends.deps import install_backend_deps
from ..config import settings
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


def _resolve_model_path(model_path: str) -> str:
    """Resolve a model ID (relative) to an absolute path under models_path."""
    p = Path(model_path)
    if p.is_absolute():
        return model_path
    return str(Path(settings.models_path) / model_path)


async def _auto_install_deps(backend: str) -> None:
    """Install missing backend dependencies. Raises HTTPException on failure."""
    logger.info(f"Auto-installing missing dependencies for backend '{backend}'...")
    async for event in install_backend_deps(backend, device=settings.device):
        if event.get("status") == "error":
            raise HTTPException(status_code=500, detail=event.get("message", f"Failed to install {backend} dependencies"))
    logger.info(f"Dependencies for '{backend}' installed successfully, retrying generation")


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


def _build_params(req: GenerateRequest) -> GenerateParams:
    return GenerateParams(
        text=req.text,
        voice_path=req.voice_path,
        reference_audio=_normalize_to_list(req.reference_audio),
        reference_audio_data=req.reference_audio_data,
        reference_cache_key=req.reference_cache_key,
        reference_text=_normalize_to_list(req.reference_text),
        instruct_text=req.instruct_text,
        instruct_gender=req.instruct_gender,
        speed=req.speed,
        language=req.language,
    )


def _check_reference_cache(req: GenerateRequest, backend_name: str, model_path: str) -> None:
    """Raise 412 if cloning voice cache is missing and no audio data was provided."""
    if not req.reference_cache_key and not req.reference_audio:
        return
    if req.reference_audio_data:
        return

    from ..services.model_manager import model_manager as mm
    try:
        backend = mm.get_backend(backend_name, model_path)
    except Exception:
        return  # let the main handler deal with backend errors

    params = _build_params(req)
    if backend.needs_reference_audio(params):
        raise HTTPException(status_code=412, detail="Reference audio cache miss")


@router.post("/generate")
async def generate(req: GenerateRequest):
    params = _build_params(req)
    model_path = _resolve_model_path(req.model_path)
    _check_reference_cache(req, req.backend, model_path)

    try:
        result = model_manager.generate(req.backend, model_path, params)
    except ModuleNotFoundError:
        await _auto_install_deps(req.backend)
        try:
            result = model_manager.generate(req.backend, model_path, params)
        except Exception as e:
            logger.exception(f"Generation failed after dep install: {e}")
            raise HTTPException(status_code=500, detail=str(e))
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
    params = _build_params(req)
    model_path = _resolve_model_path(req.model_path)

    try:
        backend = model_manager.get_backend(req.backend, model_path)
    except ModuleNotFoundError:
        await _auto_install_deps(req.backend)
        try:
            backend = model_manager.get_backend(req.backend, model_path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception(f"Failed to load backend after dep install: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if backend.needs_reference_audio(params):
        raise HTTPException(status_code=412, detail="Reference audio cache miss")

    headers = {
        "X-Sample-Rate": str(backend.sample_rate),
        "X-Channels": "1",
        "X-Bits-Per-Sample": "16",
    }

    try:
        if backend.supports_streaming():
            gen = model_manager.generate_stream(req.backend, model_path, params)
            return StreamingResponse(
                stream_pcm_chunks(gen),
                media_type="audio/pcm",
                headers=headers,
            )

        return StreamingResponse(
            _generate_with_keepalive(req.backend, model_path, params),
            media_type="audio/pcm",
            headers=headers,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Streaming generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
