import asyncio
import json

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from . import logs, stats

router = APIRouter()
_STATS_EVERY = 30


@router.get("/events")
async def events(request: Request):
    async def generator():
        queue = logs.subscribe()
        try:
            loop = asyncio.get_running_loop()
            yield {"event": "stats", "data": json.dumps(stats._snapshot())}
            next_sample = loop.time() + stats._SAMPLE_EVERY
            next_stats = loop.time() + _STATS_EVERY
            # Logs and telemetry have independent deadlines, so a chatty worker still refreshes its gauges.
            while not await request.is_disconnected():
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=max(0.0, min(next_sample, next_stats) - loop.time()))
                    yield {"event": "log", "data": json.dumps(entry)}
                except asyncio.TimeoutError:
                    pass
                now = loop.time()
                if now >= next_sample:
                    next_sample = now + stats._SAMPLE_EVERY
                    if stats._history:
                        yield {"event": "sample", "data": json.dumps(stats._history[-1])}
                if now >= next_stats:
                    next_stats = now + _STATS_EVERY
                    yield {"event": "stats", "data": json.dumps(stats._snapshot())}
        finally:
            logs.unsubscribe(queue)

    return EventSourceResponse(generator())
