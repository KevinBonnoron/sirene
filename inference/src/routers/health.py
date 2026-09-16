from fastapi import APIRouter

from ..backends.base import TTSBackend
from ..backends.registry import list_backend_names
from ..config import settings
from ..services import gpu, registration
from ..services.model_manager import model_manager

router = APIRouter()

_effective: str | None = None


def effective_device() -> str:
    global _effective
    if _effective is None:
        _effective = TTSBackend._resolve_device(settings.device)
    return _effective


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "device": effective_device(),
        "gpu_memory": gpu.memory_total(),
        "backends": list_backend_names(),
        "loaded_models": len(model_manager._loaded),
        "registration": registration.status(),
    }
