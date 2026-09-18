import asyncio
import errno
import io
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

import httpx

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from ..backends.deps import install_backend_deps, is_installed, summarize_pip_error
from ..config import settings
from ..schemas import ModelPullRequest, ModelUnloadRequest
from ..services.downloader import download_model_files
from ..services.model_manager import model_manager

router = APIRouter(prefix="/models")
logger = logging.getLogger(__name__)


def _scan_custom_piper_models(models_path: Path) -> list[dict]:
    if not models_path.exists():
        return []

    custom = []
    for entry in sorted(models_path.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        onnx_files = [
            f for f in entry.rglob("*.onnx") if not f.name.endswith(".onnx.json")
        ]
        if not onnx_files:
            continue

        onnx_path = onnx_files[0]
        config_path = Path(str(onnx_path) + ".json")
        if not config_path.exists():
            continue

        try:
            config_data = json.loads(config_path.read_text())
        except Exception:
            continue

        if "espeak" not in config_data or "phoneme_id_map" not in config_data:
            continue

        onnx_stat = onnx_path.stat()
        espeak_voice = (config_data.get("espeak") or {}).get("voice", "")
        parts = entry.name.replace("piper-", "", 1).split("-")
        locale = parts[0].split("_")[0].upper() if parts else espeak_voice.upper()
        speaker = parts[1].capitalize() if len(parts) > 1 else "Custom"

        speaker_map = config_data.get("speaker_id_map") or {}
        num_speakers = config_data.get("num_speakers", 1)
        if num_speakers > 1 and speaker_map:
            preset_voices = [{"id": k, "label": k} for k in speaker_map]
        else:
            preset_voices = [{"id": "default", "label": speaker}]

        rel_onnx = str(onnx_path.relative_to(entry))
        rel_config = str(config_path.relative_to(entry))

        custom.append(
            {
                "id": entry.name,
                "name": f"Piper {locale} {speaker}",
                "backend": "piper",
                "backendDisplayName": "Piper",
                "backendDescription": "Fast and lightweight offline TTS with a wide range of languages.",
                "description": f"Piper - custom voice ({espeak_voice}).",
                "repo": "",
                "files": [rel_onnx, rel_config],
                "size": onnx_stat.st_size,
                "types": ["preset"],
                "presetVoices": preset_voices,
            }
        )

    return custom


@router.get("")
async def list_models():
    models_path = Path(settings.models_path)
    installed = (
        [
            d.name
            for d in sorted(models_path.iterdir())
            if not d.name.startswith(".") and holds_a_model(d)
        ]
        if models_path.exists()
        else []
    )
    custom = _scan_custom_piper_models(models_path)
    return {"installed": installed, "custom": custom}


def describe_pull_error(exc: BaseException) -> str:
    if isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
        return "No space left on the inference server's disk."
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Hugging Face refused the download: gated model, check the HF token."
        if code == 404:
            return "A model file was not found on Hugging Face."
        return f"Hugging Face returned HTTP {code} while downloading."
    if isinstance(exc, httpx.TransportError):
        return "The inference server could not reach Hugging Face."
    if isinstance(exc, RuntimeError) and str(exc):
        return "Dependency install failed: " + summarize_pip_error(str(exc))
    return "Model pull failed. See inference server logs for details."


_MODEL_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")
_IMPORT_MAX_BYTES = 4 * 1024**3
_IMPORT_MAX_ENTRIES = 512
_publish_locks: dict[str, asyncio.Lock] = {}


LOCALE = re.compile(r"^[a-z]{2,3}(_[A-Z]{2,3})?$")


# The pattern allows dots: "." and ".." would land beside or above the store, and a leading
# dot hides the directory from the listing, so the import would succeed into nothing.
def model_dir_for(model_id: str) -> Path:
    if not _MODEL_ID.fullmatch(model_id) or model_id.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid model id")
    return Path(settings.models_path) / model_id


def locale_of(espeak_voice: str) -> str:
    parts = espeak_voice.split("-")
    lang = parts[0] if parts else ""
    region = parts[1] if len(parts) > 1 else None
    locale = f"{lang.lower()}_{region.upper()}" if region else lang.lower()
    if not LOCALE.fullmatch(locale):
        raise HTTPException(
            status_code=400,
            detail=f'Config declares an unusable espeak voice "{espeak_voice}"',
        )
    return locale


def holds_a_model(path: Path) -> bool:
    return path.is_dir() and any(f.is_file() for f in path.rglob("*"))


def _publish_lock(model_id: str) -> asyncio.Lock:
    return _publish_locks.setdefault(model_id, asyncio.Lock())


async def _publish(staging: Path, model_dir: Path) -> bool:
    """Moves a finished staging directory into place; False when another pull got there first."""
    async with _publish_lock(model_dir.name):
        # os.replace onto a file or a symlink raises instead of publishing.
        if holds_a_model(model_dir) or model_dir.is_symlink() or (model_dir.exists() and not model_dir.is_dir()):
            shutil.rmtree(staging, ignore_errors=True)
            return False
        # os.replace only lands on a directory it can unlink, so nested empties must go.
        if model_dir.exists():
            shutil.rmtree(model_dir, ignore_errors=True)
        os.replace(staging, model_dir)
        return True


@router.post("/pull")
async def pull_model(req: ModelPullRequest):
    model_path = model_dir_for(req.model_id)
    # Each pull owns a staging directory and publishes it atomically, so a failed or concurrent pull never touches a finished one.
    staging = (
        Path(settings.models_path) / f".{req.model_id}.pull-{uuid.uuid4().hex[:8]}"
    )

    async def event_generator():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()
        failed = asyncio.Event()

        async def produce(gen):
            reported = False
            try:
                async for event in gen:
                    if failed.is_set():
                        return
                    if event.get("status") == "error":
                        reported = True
                    await queue.put(event)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Model pull producer failed for model_id=%s", req.model_id
                )
                failed.set()
                if not reported:
                    await queue.put(
                        {"status": "error", "message": describe_pull_error(exc)}
                    )

        tasks = [
            asyncio.create_task(
                produce(
                    download_model_files(
                        model_path=staging,
                        files=req.files,
                        total_size=req.total_size,
                        hf_token=req.hf_token,
                    )
                )
            )
        ]

        if not is_installed(req.backend):
            tasks.append(
                asyncio.create_task(
                    produce(
                        install_backend_deps(
                            req.backend,
                            device=settings.device,
                        )
                    )
                )
            )

        async def drain():
            try:
                await asyncio.gather(*tasks, return_exceptions=True)
                if failed.is_set():
                    shutil.rmtree(staging, ignore_errors=True)
                elif staging.exists():
                    try:
                        # A refused publication discards the staged model, so reporting
                        # success here would claim an install that never landed.
                        if not await _publish(staging, model_path):
                            await queue.put(
                                {
                                    "status": "error",
                                    "message": f"Could not publish {req.model_id!r}: its directory is already taken",
                                }
                            )
                    except OSError as exc:
                        shutil.rmtree(staging, ignore_errors=True)
                        logger.exception(
                            "Publishing model_id=%s failed", req.model_id
                        )
                        # str(exc) carries the staging path and its random suffix, which
                        # names an implementation detail rather than anything actionable.
                        await queue.put(
                            {
                                "status": "error",
                                "message": f"Could not publish {req.model_id!r}: {exc.strerror or 'the model store refused the write'}",
                            }
                        )
            finally:
                await queue.put(None)

        asyncio.create_task(drain())

        while True:
            event = await queue.get()
            if event is None:
                break
            yield {"data": json.dumps(event)}

    return EventSourceResponse(event_generator())


@router.post("/piper/import")
async def import_piper_model(
    onnx: UploadFile = File(...),
    config: UploadFile = File(...),
    name: str = Form(...),
):
    config_text = await config.read()
    try:
        config_data = json.loads(config_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Config file is not valid JSON")

    if "espeak" not in config_data or "phoneme_id_map" not in config_data:
        raise HTTPException(
            status_code=400,
            detail='Config must contain "espeak" and "phoneme_id_map" fields (Piper format)',
        )

    locale = locale_of((config_data.get("espeak") or {}).get("voice", ""))

    sample_rate = (config_data.get("audio") or {}).get("sample_rate", 22050)
    quality = "low" if sample_rate <= 16000 else "medium"

    speaker_slug = "".join(
        c if (c.isalnum() or c == "_") else "_"
        for c in name.strip().lower().replace(" ", "_")
    )
    speaker_slug = "".join(c for c in speaker_slug if c.isalnum() or c == "_")
    if not speaker_slug:
        raise HTTPException(status_code=400, detail="Invalid model name")

    slug = f"piper-{locale}-{speaker_slug}-{quality}"
    model_dir = Path(settings.models_path) / slug

    if holds_a_model(model_dir):
        raise HTTPException(
            status_code=409, detail=f'A model directory "{slug}" already exists'
        )

    uploaded_name = Path(onnx.filename or "").name
    onnx_name = uploaded_name if uploaded_name.endswith(".onnx") else f"{speaker_slug}.onnx"
    config_name = f"{onnx_name}.json"

    onnx_data = await onnx.read()

    staging = Path(settings.models_path) / f".{slug}.import-{uuid.uuid4().hex[:8]}"
    staging.mkdir(parents=True)
    try:
        (staging / onnx_name).write_bytes(onnx_data)
        (staging / config_name).write_bytes(config_text)
        published = await _publish(staging, model_dir)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if not published:
        raise HTTPException(
            status_code=409, detail=f'A model directory "{slug}" already exists'
        )
    return {"id": slug, "message": "Piper model imported"}


@router.post("/unload")
async def unload_model(req: ModelUnloadRequest):
    try:
        unloaded = model_manager.unload(req.backend, req.model_path)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not unloaded:
        raise HTTPException(status_code=404, detail="Model not currently loaded")
    return {"message": f"Unloaded {req.backend} model from {req.model_path}"}


class _StreamBuffer(io.RawIOBase):
    def __init__(self) -> None:
        self._buf = bytearray()
        self._pos = 0

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def write(self, b) -> int:
        n = len(b)
        self._buf.extend(b)
        self._pos += n
        return n

    def tell(self) -> int:
        return self._pos

    def drain(self) -> bytes:
        data = bytes(self._buf)
        self._buf.clear()
        return data


@router.post("/{model_id}/import")
async def import_model(model_id: str, archive: UploadFile = File(...)):
    model_dir = model_dir_for(model_id)
    if holds_a_model(model_dir):
        raise HTTPException(
            status_code=409, detail=f'A model directory "{model_id}" already exists'
        )
    with tempfile.TemporaryFile() as tmp:
        total = 0
        while chunk := await archive.read(1024 * 1024):
            total += len(chunk)
            if total > _IMPORT_MAX_BYTES:
                raise HTTPException(status_code=413, detail="Archive too large")
            tmp.write(chunk)
        tmp.seek(0)
        try:
            zf = zipfile.ZipFile(tmp)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Archive is not a zip file")
        with zf:
            # One entry list for accounting, path checks and extraction, so duplicate names can't slip past the size sum.
            entries = zf.infolist()
            if len(entries) > _IMPORT_MAX_ENTRIES:
                raise HTTPException(
                    status_code=413, detail="Archive has too many entries"
                )
            if sum(info.file_size for info in entries) > _IMPORT_MAX_BYTES:
                raise HTTPException(
                    status_code=413, detail="Archive expands beyond the size limit"
                )
            staging = (
                Path(settings.models_path)
                / f".{model_id}.import-{uuid.uuid4().hex[:8]}"
            )
            root = staging.resolve()
            for info in entries:
                dest = (staging / info.filename).resolve()
                if dest != root and not str(dest).startswith(str(root) + os.sep):
                    raise HTTPException(
                        status_code=400, detail="Archive contains an invalid path"
                    )
            staging.mkdir(parents=True)
            try:
                await asyncio.to_thread(zf.extractall, staging, entries)
                published = await _publish(staging, model_dir)
            except Exception:
                shutil.rmtree(staging, ignore_errors=True)
                raise
    if not published:
        raise HTTPException(
            status_code=409, detail=f'A model directory "{model_id}" already exists'
        )
    return {"id": model_id, "message": "Model imported"}


@router.get("/{model_id}/export")
async def export_model(model_id: str):
    model_dir = model_dir_for(model_id)
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail=f"Model {model_id!r} not found")

    files = sorted(p for p in model_dir.rglob("*") if p.is_file())

    def stream_zip():
        buffer = _StreamBuffer()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as zf:
            for f in files:
                arcname = str(f.relative_to(model_dir))
                with zf.open(arcname, "w") as entry, open(f, "rb") as src:
                    while chunk := src.read(1024 * 1024):
                        entry.write(chunk)
                        if out := buffer.drain():
                            yield out
                if out := buffer.drain():
                    yield out
        if out := buffer.drain():
            yield out

    return StreamingResponse(
        stream_zip(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="piper-{model_id}.zip"'},
    )


@router.delete("/{model_id}")
async def delete_model(model_id: str):
    model_dir = model_dir_for(model_id)
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail=f"Model {model_id!r} not found")
    shutil.rmtree(model_dir)
    return {"message": f"Model {model_id!r} deleted"}
