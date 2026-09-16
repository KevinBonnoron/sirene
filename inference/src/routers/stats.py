import asyncio
import os
import shutil
import time
from collections import deque
from typing import Any

import psutil
from fastapi import APIRouter

from ..config import settings
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


def _gpu() -> list[dict[str, Any]]:
    try:
        import pynvml

        pynvml.nvmlInit()
    except Exception:
        return []
    out = []
    pid = os.getpid()
    try:
        for i in range(pynvml.nvmlDeviceGetCount()):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            name = pynvml.nvmlDeviceGetName(handle)
            process_used = 0
            try:
                for p in pynvml.nvmlDeviceGetComputeRunningProcesses(handle):
                    if p.pid == pid and p.usedGpuMemory:
                        process_used = int(p.usedGpuMemory)
            except Exception:
                pass
            out.append(
                {
                    "index": i,
                    "name": name.decode() if isinstance(name, bytes) else str(name),
                    "utilization": util.gpu,
                    "memoryUsed": process_used,
                    "memoryTotal": int(mem.total),
                }
            )
    except Exception:
        pass
    finally:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass
    return out


def _snapshot() -> dict[str, Any]:
    cores = psutil.cpu_count() or 1
    disk = shutil.disk_usage(settings.models_path if os.path.isdir(settings.models_path) else "/")
    return {
        "device": effective_device(),
        "cpu": {"percent": _cpu_percent, "cores": cores},
        "memory": {"used": int(_proc.memory_info().rss), "total": int(psutil.virtual_memory().total)},
        "disk": {"used": int(disk.used), "total": int(disk.total)},
        "gpus": _gpu(),
        "loadedModels": [f"{backend}/{os.path.basename(str(model))}" for backend, model in model_manager._loaded],
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
            _cpu_percent = round(_proc.cpu_percent(interval=None) / (psutil.cpu_count() or 1), 1)
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
