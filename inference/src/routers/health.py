from fastapi import APIRouter

from ..config import settings
from ..services.model_manager import model_manager

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "device": settings.device,
        "loaded_models": len(model_manager._loaded),
    }
