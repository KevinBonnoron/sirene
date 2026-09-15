import os
from typing import Any


def query() -> list[dict[str, Any]]:
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


def memory_total() -> int:
    gpus = query()
    return gpus[0]["memoryTotal"] if gpus else 0
