import asyncio
import logging
import re
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Query

router = APIRouter()

_CAPACITY = 1000
_PROBE = re.compile(r"\"GET /(health|models|stats|logs|events)[ ?]")
_buffer: deque[dict] = deque(maxlen=_CAPACITY)
_subscribers: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None


def subscribe() -> asyncio.Queue:
    global _loop
    _loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def _fan_out(entry: dict) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            pass


class RingBufferHandler(logging.Handler):
    formatter_for_exceptions = logging.Formatter()

    def emit(self, record: logging.LogRecord) -> None:
        if record.name == "uvicorn.access" and _PROBE.search(record.getMessage()):
            return
        try:
            message = record.getMessage()
            if record.exc_info:
                message += "\n" + self.formatter_for_exceptions.formatException(
                    record.exc_info
                )
            entry = {
                "time": datetime.fromtimestamp(
                    record.created, tz=timezone.utc
                ).isoformat(timespec="milliseconds"),
                "level": record.levelname,
                "logger": record.name,
                "message": message,
            }
            _buffer.append(entry)
            if _loop is not None and _subscribers:
                _loop.call_soon_threadsafe(_fan_out, entry)
        except Exception:
            pass


@router.get("/logs")
async def logs(limit: int = Query(200, ge=1, le=_CAPACITY), level: str = Query("")):
    floor = logging.getLevelNamesMapping().get(level.upper(), logging.NOTSET)
    # Snapshot first: the handler appends from other threads.
    lines = [
        entry
        for entry in list(_buffer)
        if logging.getLevelNamesMapping().get(entry["level"], logging.NOTSET) >= floor
    ]
    return {"lines": lines[-limit:], "capacity": _CAPACITY}
