import os
import shutil
from typing import Any

import psutil
from fastapi import APIRouter

from ..config import settings
from ..services.model_manager import model_manager
from .health import effective_device

router = APIRouter()
psutil.cpu_percent(interval=None)


def _gpu() -> list[dict[str, Any]]:
    try:
        import pynvml

        pynvml.nvmlInit()
    except Exception:
        return []
    out = []
    try:
        for i in range(pynvml.nvmlDeviceGetCount()):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            name = pynvml.nvmlDeviceGetName(handle)
            out.append(
                {
                    "index": i,
                    "name": name.decode() if isinstance(name, bytes) else str(name),
                    "utilization": util.gpu,
                    "memoryUsed": int(mem.used),
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


@router.get("/stats")
async def stats():
    mem = psutil.virtual_memory()
    disk = shutil.disk_usage(settings.models_path if os.path.isdir(settings.models_path) else "/")
    proc = psutil.Process()
    return {
        "device": effective_device(),
        "cpu": {"percent": psutil.cpu_percent(interval=None), "cores": psutil.cpu_count() or 0},
        "memory": {"used": int(mem.used), "total": int(mem.total)},
        "process": {"rss": int(proc.memory_info().rss)},
        "disk": {"used": int(disk.used), "total": int(disk.total)},
        "gpus": _gpu(),
        "loadedModels": [f"{backend}/{model}" for backend, model in model_manager._loaded],
    }
