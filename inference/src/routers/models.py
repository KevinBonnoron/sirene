import asyncio
import io
import json
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from ..backends.deps import install_backend_deps, is_installed
from ..config import settings
from ..schemas import ModelPullRequest, ModelUnloadRequest
from ..services.downloader import download_model_files
from ..services.model_manager import model_manager

router = APIRouter(prefix="/models")


@router.get("")
async def list_installed_models():
    models_path = Path(settings.models_path)
    if not models_path.exists():
        return []
    return [d.name for d in sorted(models_path.iterdir()) if d.is_dir()]


@router.get("/piper-custom")
async def list_custom_piper_models():
    """Returns CatalogModel-compatible metadata for user-imported Piper models."""
    models_path = Path(settings.models_path)
    if not models_path.exists():
        return []

    custom = []
    for entry in sorted(models_path.iterdir()):
        if not entry.is_dir():
            continue

        onnx_files = [f for f in entry.rglob("*.onnx") if not f.name.endswith(".onnx.json")]
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

        custom.append({
            "id": entry.name,
            "name": f"Piper {locale} {speaker}",
            "backend": "piper",
            "backendDisplayName": "Piper",
            "backendDescription": "Fast and lightweight offline TTS with a wide range of languages.",
            "description": f"Piper — custom voice ({espeak_voice}).",
            "repo": "",
            "files": [rel_onnx, rel_config],
            "size": onnx_stat.st_size,
            "types": ["preset"],
            "presetVoices": preset_voices,
        })

    return custom


@router.post("/pull")
async def pull_model(req: ModelPullRequest):
    model_path = Path(settings.models_path) / req.model_id

    async def event_generator():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def produce(gen):
            async for event in gen:
                await queue.put(event)

        tasks = [
            asyncio.create_task(produce(download_model_files(
                model_path=model_path,
                files=req.files,
                total_size=req.total_size,
                hf_token=req.hf_token,
            )))
        ]

        if not is_installed(req.backend):
            tasks.append(asyncio.create_task(produce(install_backend_deps(
                req.backend,
                device=settings.device,
            ))))

        async def drain():
            await asyncio.gather(*tasks)
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
        raise HTTPException(status_code=400, detail='Config must contain "espeak" and "phoneme_id_map" fields (Piper format)')

    espeak_voice = (config_data.get("espeak") or {}).get("voice", "")
    parts = espeak_voice.split("-")
    lang_part = parts[0] if parts else ""
    region_part = parts[1] if len(parts) > 1 else None
    locale = f"{lang_part.lower()}_{region_part.upper()}" if region_part else lang_part.lower()

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

    if model_dir.exists():
        raise HTTPException(status_code=409, detail=f'A model directory "{slug}" already exists')

    model_dir.mkdir(parents=True, exist_ok=True)

    onnx_name = onnx.filename if (onnx.filename or "").endswith(".onnx") else f"{speaker_slug}.onnx"
    config_name = f"{onnx_name}.json"

    onnx_data = await onnx.read()
    (model_dir / onnx_name).write_bytes(onnx_data)
    (model_dir / config_name).write_bytes(config_text)

    return {"id": slug, "message": "Piper model imported"}


@router.post("/unload")
async def unload_model(req: ModelUnloadRequest):
    unloaded = model_manager.unload(req.backend, req.model_path)
    if not unloaded:
        raise HTTPException(status_code=404, detail="Model not currently loaded")
    return {"message": f"Unloaded {req.backend} model from {req.model_path}"}


@router.get("/{model_id}/export")
async def export_model(model_id: str):
    model_dir = Path(settings.models_path) / model_id
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail=f"Model {model_id!r} not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in model_dir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(model_dir))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="piper-{model_id}.zip"'},
    )


@router.delete("/{model_id}")
async def delete_model(model_id: str):
    model_dir = Path(settings.models_path) / model_id
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail=f"Model {model_id!r} not found")
    shutil.rmtree(model_dir)
    return {"message": f"Model {model_id!r} deleted"}
