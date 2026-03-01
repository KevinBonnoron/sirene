from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..backends.deps import install_backend_deps, is_installed, list_installable_backends
from ..backends.registry import list_backend_names
from ..config import settings
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


@router.post("/{name}/install")
async def install_backend(name: str):
    if name not in list_installable_backends():
        raise HTTPException(status_code=404, detail=f"Backend {name!r} not found")

    if is_installed(name):
        return JSONResponse({"status": "already_installed"})

    async for event in install_backend_deps(name, device=settings.device):
        if event.get("status") == "error":
            raise HTTPException(status_code=500, detail=event.get("message", "Install failed"))

    return JSONResponse({"status": "installed"})
