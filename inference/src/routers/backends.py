from fastapi import APIRouter, HTTPException

from ..backends.registry import list_backend_names
from ..services.model_manager import model_manager

router = APIRouter(prefix="/backends")


@router.get("")
async def list_backends():
    return {"backends": model_manager.get_status()}


@router.get("/{name}/status")
async def backend_status(name: str):
    if name not in list_backend_names():
        raise HTTPException(status_code=404, detail=f"Backend {name!r} not found")
    return model_manager.get_backend_status(name)
