import asyncio
import logging
import os
import socket
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_RETRY_DELAYS = (2, 4, 8, 16, 32)

_state: dict[str, Any] = {"status": "disabled", "error": "", "server": None}


def status() -> dict[str, Any]:
    return dict(_state)


def public_url() -> str:
    explicit = os.environ.get("INFERENCE_PUBLIC_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    railway = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway:
        return f"https://{railway}"
    pod = os.environ.get("RUNPOD_POD_ID", "").strip()
    if pod:
        return f"https://{pod}-8000.proxy.runpod.net"
    return ""


def worker_name() -> str:
    for key in ("INFERENCE_NAME", "RAILWAY_SERVICE_NAME"):
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return socket.gethostname()


def _json_object(res: httpx.Response) -> dict[str, Any] | None:
    try:
        body = res.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


async def register() -> None:
    sirene_url = os.environ.get("SIRENE_URL", "").strip().rstrip("/")
    token = os.environ.get("SIRENE_REGISTRATION_TOKEN", "").strip()
    if not sirene_url or not token:
        return

    url = public_url()
    if not url:
        _state.update(status="failed", error="INFERENCE_PUBLIC_URL is not set")
        logger.error(
            "[registration] SIRENE_URL is set but the worker's public URL is unknown; set INFERENCE_PUBLIC_URL"
        )
        return

    _state.update(status="pending", error="")
    payload = {"name": worker_name(), "url": url, "authToken": settings.auth_token}
    headers = {"Authorization": f"Bearer {token}"}
    endpoint = f"{sirene_url}/api/inference-servers/register"

    async with httpx.AsyncClient(timeout=15) as client:
        for attempt, delay in enumerate((*_RETRY_DELAYS, None), start=1):
            try:
                res = await client.post(endpoint, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                error = "Sirene server unreachable"
                logger.warning(
                    "[registration] attempt %d failed: %s: %s",
                    attempt,
                    type(exc).__name__,
                    exc,
                )
            else:
                body = _json_object(res)
                if res.status_code in (200, 201) and body is not None:
                    _state.update(status="registered", error="", server=body)
                    logger.info(
                        "[registration] registered as %r at %s (%s)",
                        body.get("name"),
                        sirene_url,
                        "created" if body.get("created") else "updated",
                    )
                    return
                if res.status_code in (200, 201):
                    error = "unexpected response from Sirene"
                else:
                    error = f"HTTP {res.status_code}"
                    if body and isinstance(body.get("message"), str):
                        error += f": {body['message']}"
                logger.warning(
                    "[registration] attempt %d failed: %s (%s)",
                    attempt,
                    error,
                    res.text[:300],
                )
                if res.status_code in (400, 401, 403, 404, 405):
                    break
            if delay is None:
                break
            await asyncio.sleep(delay)

    _state.update(status="failed", error=error)
    logger.error("[registration] giving up: %s", error)
