import importlib
import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import backends, cache, generate, health, models, transcribe
from .services.model_manager import model_manager

# Runtime packages dir (volume-backed in Docker) — add to sys.path so lazily
# installed backend deps are importable without restarting the process.
_packages_dir = os.environ.get("PACKAGES_DIR")
if _packages_dir:
    os.makedirs(_packages_dir, exist_ok=True)
    if _packages_dir not in sys.path:
        sys.path.insert(0, _packages_dir)
        importlib.invalidate_caches()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logging.getLogger("sse_starlette.sse").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Sirene Inference starting on {settings.host}:{settings.port}")
    logger.info(f"Device: {settings.device}, Models path: {settings.models_path}")
    logger.info(f"Prompt cache: {settings.cache_dir} (max {settings.cache_max_disk_mb}MB)")
    yield
    model_manager.unload_all()
    logger.info("All models unloaded, shutting down")


app = FastAPI(
    title="Sirene Inference",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(generate.router)
app.include_router(backends.router)
app.include_router(models.router)
app.include_router(transcribe.router)
app.include_router(cache.router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
