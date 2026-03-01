import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


async def download_model_files(
    model_path: Path,
    files: list,
    total_size: int,
    hf_token: str | None = None,
):
    """Async generator yielding progress dicts as files download."""
    model_path.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    headers = {}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        for file_entry in files:
            file_path = model_path / file_entry.path
            file_path.parent.mkdir(parents=True, exist_ok=True)

            async with client.stream("GET", file_entry.url, headers=headers) as response:
                response.raise_for_status()
                with open(file_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        downloaded += len(chunk)
                        progress = min(int((downloaded / total_size) * 100), 99)
                        yield {
                            "status": "downloading",
                            "file": file_entry.path,
                            "progress": progress,
                            "downloaded": downloaded,
                            "total": total_size,
                        }

    yield {
        "status": "complete",
        "progress": 100,
        "downloaded": total_size,
        "total": total_size,
    }
