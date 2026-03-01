import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


async def download_model_files(
    base_url: str,
    files: list[str],
    dest_path: str,
    total_size: int,
):
    """Async generator yielding progress dicts as files download."""
    dest = Path(dest_path)
    dest.mkdir(parents=True, exist_ok=True)

    downloaded = 0

    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        for filename in files:
            url = f"{base_url}/{filename}"
            file_path = dest / filename
            file_path.parent.mkdir(parents=True, exist_ok=True)

            async with client.stream("GET", url) as response:
                response.raise_for_status()
                with open(file_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        downloaded += len(chunk)
                        progress = min(int((downloaded / total_size) * 100), 99)
                        yield {
                            "status": "downloading",
                            "file": filename,
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
