"""Two-level cache for voice cloning reference data.

Level 1 (L1): Downloaded + concatenated reference audio files (disk only).
Level 2 (L2): Backend-specific intermediate representations (memory + disk).
"""

import hashlib
import logging
import shutil
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class PromptCache:

    def __init__(self, cache_dir: str, max_disk_size_mb: int = 2048):
        self._cache_dir = Path(cache_dir)
        self._audio_dir = self._cache_dir / "audio"
        self._prompt_dir = self._cache_dir / "prompts"
        self._audio_dir.mkdir(parents=True, exist_ok=True)
        self._prompt_dir.mkdir(parents=True, exist_ok=True)

        self._max_disk_bytes = max_disk_size_mb * 1024 * 1024
        self._memory: dict[str, Any] = {}
        self._lock = threading.Lock()

    # ── Key generation ──

    @staticmethod
    def audio_cache_key(urls: list[str], max_duration: float) -> str:
        """L1 key from sorted URLs + max_duration."""
        canonical = "\n".join(sorted(urls)) + f"|{max_duration}"
        return hashlib.sha256(canonical.encode()).hexdigest()[:24]

    @staticmethod
    def prompt_cache_key(audio_path: str, backend_name: str, ref_text: str = "") -> str:
        """L2 key from audio file content + backend name + optional ref text."""
        h = hashlib.sha256()
        with open(audio_path, "rb") as f:
            h.update(f.read())
        if ref_text:
            h.update(ref_text.encode())
        return f"{backend_name}_{h.hexdigest()[:24]}"

    # ── Level 1: Reference audio files ──

    def get_audio(self, key: str) -> str | None:
        """Return cached audio file path, or None on miss."""
        path = self._audio_dir / f"{key}.wav"
        if path.exists():
            path.touch()  # update mtime for LRU
            logger.debug(f"[cache] L1 hit: {key}")
            return str(path)
        return None

    def put_audio(self, key: str, source_path: str) -> str:
        """Move a temp file into the cache. Returns the cached path."""
        dest = self._audio_dir / f"{key}.wav"
        shutil.move(source_path, dest)
        logger.debug(f"[cache] L1 stored: {key}")
        return str(dest)

    # ── Level 2: Prompt representations ──

    def get_prompt(self, key: str) -> Any | None:
        """Return cached prompt from memory or disk, or None on miss."""
        with self._lock:
            if key in self._memory:
                logger.debug(f"[cache] L2 memory hit: {key}")
                return self._memory[key]

        path = self._prompt_dir / f"{key}.pt"
        if path.exists():
            try:
                import torch

                prompt = torch.load(path, map_location="cpu", weights_only=False)
                with self._lock:
                    self._memory[key] = prompt
                path.touch()
                logger.debug(f"[cache] L2 disk hit: {key}")
                return prompt
            except Exception:
                logger.warning(f"[cache] Corrupt cache file {path}, removing")
                path.unlink(missing_ok=True)
        return None

    def put_prompt(self, key: str, prompt: Any) -> None:
        """Cache a prompt to memory and disk."""
        import torch

        with self._lock:
            self._memory[key] = prompt
        path = self._prompt_dir / f"{key}.pt"
        torch.save(prompt, path)
        logger.debug(f"[cache] L2 stored: {key}")

    # ── Maintenance ──

    def clear_all(self) -> dict:
        """Clear all caches. Returns counts."""
        with self._lock:
            mem_count = len(self._memory)
            self._memory.clear()

        audio_count = sum(1 for _ in self._audio_dir.glob("*.wav"))
        prompt_count = sum(1 for _ in self._prompt_dir.glob("*.pt"))

        for f in self._audio_dir.glob("*.wav"):
            f.unlink(missing_ok=True)
        for f in self._prompt_dir.glob("*.pt"):
            f.unlink(missing_ok=True)

        return {
            "memory_entries_cleared": mem_count,
            "audio_files_deleted": audio_count,
            "prompt_files_deleted": prompt_count,
        }

    def stats(self) -> dict:
        """Return cache statistics."""
        audio_files = list(self._audio_dir.glob("*.wav"))
        prompt_files = list(self._prompt_dir.glob("*.pt"))
        return {
            "audio_files": len(audio_files),
            "audio_size_mb": round(
                sum(f.stat().st_size for f in audio_files) / (1024 * 1024), 2
            ),
            "prompt_files": len(prompt_files),
            "prompt_size_mb": round(
                sum(f.stat().st_size for f in prompt_files) / (1024 * 1024), 2
            ),
            "memory_entries": len(self._memory),
        }

    def evict_lru(self) -> int:
        """Evict oldest files if total disk usage exceeds max. Returns count evicted."""
        all_files = list(self._audio_dir.glob("*.wav")) + list(
            self._prompt_dir.glob("*.pt")
        )
        total_size = sum(f.stat().st_size for f in all_files)
        if total_size <= self._max_disk_bytes:
            return 0

        all_files.sort(key=lambda f: f.stat().st_mtime)
        evicted = 0
        for f in all_files:
            if total_size <= self._max_disk_bytes:
                break
            size = f.stat().st_size
            f.unlink(missing_ok=True)
            total_size -= size
            evicted += 1
            if f.suffix == ".pt":
                with self._lock:
                    self._memory.pop(f.stem, None)

        logger.info(f"[cache] Evicted {evicted} files to stay within disk limit")
        return evicted


# Module-level singleton
_instance: PromptCache | None = None


def get_cache() -> PromptCache:
    """Get or create the singleton cache instance."""
    global _instance
    if _instance is None:
        from ..config import settings

        _instance = PromptCache(
            cache_dir=settings.cache_dir,
            max_disk_size_mb=settings.cache_max_disk_mb,
        )
    return _instance
