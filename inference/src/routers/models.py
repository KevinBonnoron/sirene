import json

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..schemas import ModelPullRequest, ModelUnloadRequest
from ..services.downloader import download_model_files
from ..services.model_manager import model_manager

router = APIRouter(prefix="/models")


@router.post("/pull")
async def pull_model(req: ModelPullRequest):
    async def event_generator():
        async for progress in download_model_files(
            base_url=req.url,
            files=req.files,
            dest_path=req.dest_path,
            total_size=req.total_size,
        ):
            yield {"data": json.dumps(progress)}

    return EventSourceResponse(event_generator())


@router.post("/unload")
async def unload_model(req: ModelUnloadRequest):
    unloaded = model_manager.unload(req.backend, req.model_path)
    if not unloaded:
        raise HTTPException(status_code=404, detail="Model not currently loaded")
    return {"message": f"Unloaded {req.backend} model from {req.model_path}"}
