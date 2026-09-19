import asyncio
import os
import shutil
import time
from collections import deque
from typing import Any

import psutil
from fastapi import APIRouter

from ..config import settings
from ..services import gpu
from ..services.model_manager import model_manager
from .health import effective_device

router = APIRouter()
_proc = psutil.Process()
# cpu_percent measures since its previous call, so only the sampler may call it; the route serves the cached value.
_cpu_percent = 0.0
_proc.cpu_percent(interval=None)
_HISTORY_SECONDS = 6 * 60 * 60
_SAMPLE_EVERY = 5
_history: deque[dict[str, Any]] = deque(maxlen=_HISTORY_SECONDS // _SAMPLE_EVERY)


def _snapshot() -> dict[str, Any]:
    cores = psutil.cpu_count() or 1
    disk = shutil.disk_usage(
        settings.models_path if os.path.isdir(settings.models_path) else "/"
    )
    return {
        "device": effective_device(),
        "cpu": {"percent": _cpu_percent, "cores": cores},
        "memory": {
            "used": int(_proc.memory_info().rss),
            "total": int(psutil.virtual_memory().total),
        },
        "disk": {"used": int(disk.used), "total": int(disk.total)},
        "gpus": gpu.query(),
        "loadedModels": [
            f"{backend}/{os.path.basename(str(model))}"
            for backend, model in model_manager._loaded
        ],
    }


def _record(snapshot: dict[str, Any]) -> None:
    gpu = snapshot["gpus"][0] if snapshot["gpus"] else None
    _history.append(
        {
            "t": int(time.time() * 1000),
            "cpu": snapshot["cpu"]["percent"],
            "memory": snapshot["memory"]["used"],
            "gpu": gpu["utilization"] if gpu else None,
            "vram": gpu["memoryUsed"] if gpu else None,
        }
    )


async def sample_forever() -> None:
    global _cpu_percent
    while True:
        try:
            _cpu_percent = round(
                _proc.cpu_percent(interval=None) / (psutil.cpu_count() or 1), 1
            )
            _record(_snapshot())
        except Exception:
            pass
        await asyncio.sleep(_SAMPLE_EVERY)


@router.get("/stats")
async def stats(history: bool = False):
    snapshot = _snapshot()
    if history:
        snapshot["history"] = list(_history)
        snapshot["historySeconds"] = _HISTORY_SECONDS
    return snapshot
