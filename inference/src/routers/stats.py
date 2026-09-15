import os
import shutil
from typing import Any

import psutil
from fastapi import APIRouter

from ..config import settings
from ..services.model_manager import model_manager
from .health import effective_device

router = APIRouter()
_proc = psutil.Process()
_proc.cpu_percent(interval=None)


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


@router.get("/stats")
async def stats():
    cores = psutil.cpu_count() or 1
    disk = shutil.disk_usage(settings.models_path if os.path.isdir(settings.models_path) else "/")
    return {
        "device": effective_device(),
        "cpu": {"percent": round(_proc.cpu_percent(interval=None) / cores, 1), "cores": cores},
        "memory": {"used": int(_proc.memory_info().rss), "total": int(psutil.virtual_memory().total)},
        "disk": {"used": int(disk.used), "total": int(disk.total)},
        "gpus": _gpu(),
        "loadedModels": [f"{backend}/{model}" for backend, model in model_manager._loaded],
    }
