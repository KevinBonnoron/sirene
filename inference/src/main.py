import asyncio
import importlib
import logging
import os
import sys
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import backends, cache, generate, health, models, stats, transcribe
from .services import registration
from .services.model_manager import model_manager

# Lazily installed backend deps land here; on sys.path so they import without a restart.
_packages_dir = os.environ.get("PACKAGES_DIR")
if _packages_dir:
    os.makedirs(_packages_dir, exist_ok=True)
    if _packages_dir not in sys.path:
        sys.path.insert(0, _packages_dir)
        importlib.invalidate_caches()

# Hosting dashboards paint everything on stderr red.
_log_format = logging.Formatter("%(levelname)s %(asctime)s [%(name)s]: %(message)s")
_stdout_handler = logging.StreamHandler(sys.stdout)
_stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)
_stderr_handler = logging.StreamHandler(sys.stderr)
_stderr_handler.setLevel(logging.WARNING)
for _handler in (_stdout_handler, _stderr_handler):
    _handler.setFormatter(_log_format)
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    handlers=[_stdout_handler, _stderr_handler],
    force=True,
)
# Uvicorn installs its own handlers on these loggers, bypassing basicConfig with a second format.
for _name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    _lg = logging.getLogger(_name)
    _lg.handlers.clear()
    _lg.propagate = True
logging.getLogger("sse_starlette.sse").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Sirene Inference starting on {settings.host}:{settings.port}")
    logger.info(f"Device: {settings.device}, Models path: {settings.models_path}")
    logger.info(
        f"Prompt cache: {settings.cache_dir} (max {settings.cache_max_disk_mb}MB)"
    )
    registration_task = asyncio.create_task(registration.register())
    yield
    registration_task.cancel()
    with suppress(asyncio.CancelledError):
        await registration_task
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


@app.middleware("http")
async def bearer_auth(request: Request, call_next):
    if not settings.auth_token:
        return await call_next(request)
    # Unauthenticated liveness probes; GET/HEAD only so nothing else on this path inherits the bypass.
    if request.url.path.rstrip("/") == "/health" and request.method in ("GET", "HEAD"):
        return await call_next(request)
    # Case-insensitive scheme and surrounding whitespace are valid per RFC 6750.
    header = request.headers.get("authorization", "").strip()
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or token.strip() != settings.auth_token:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


app.include_router(health.router)
app.include_router(generate.router)
app.include_router(backends.router)
app.include_router(models.router)
app.include_router(transcribe.router)
app.include_router(cache.router)
app.include_router(stats.router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
