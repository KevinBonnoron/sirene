import logging
import threading
from collections import OrderedDict
from pathlib import Path

from ..backends.base import GenerateParams, TTSBackend, TTSResult
from ..backends.registry import get_backend_class, list_backend_names
from ..config import settings

logger = logging.getLogger(__name__)


class ModelManager:
    """Manages loaded backend instances with LRU eviction."""

    def __init__(self):
        self._loaded: OrderedDict[tuple[str, str], TTSBackend] = OrderedDict()
        self._lock = threading.Lock()

    def generate(
        self, backend_name: str, model_path: str, params: GenerateParams
    ) -> TTSResult:
        backend = self._get_or_load(backend_name, model_path)
        return backend.generate(params)

    def generate_stream(
        self, backend_name: str, model_path: str, params: GenerateParams
    ):
        backend = self._get_or_load(backend_name, model_path)
        if not backend.supports_streaming():
            raise ValueError(f"Backend {backend_name!r} does not support streaming")
        yield from backend.generate_stream(params)

    def get_backend(self, backend_name: str, model_path: str) -> TTSBackend:
        """Load (if needed) and return the backend instance without generating."""
        return self._get_or_load(backend_name, model_path)

    def _get_or_load(self, backend_name: str, model_path: str) -> TTSBackend:
        key = (backend_name, model_path)
        with self._lock:
            if key in self._loaded:
                self._loaded.move_to_end(key)
                return self._loaded[key]

            while len(self._loaded) >= settings.max_loaded_models:
                evict_key, evict_backend = self._loaded.popitem(last=False)
                logger.info(
                    f"Evicting model: backend={evict_key[0]}, path={evict_key[1]}"
                )
                evict_backend.unload_model()

            cls = get_backend_class(backend_name)
            backend = cls()
            backend.load_model(Path(model_path), settings.device)
            self._loaded[key] = backend
            logger.info(f"Loaded model: backend={backend_name}, path={model_path}")
            return backend

    def unload(self, backend_name: str, model_path: str) -> bool:
        key = (backend_name, model_path)
        with self._lock:
            backend = self._loaded.pop(key, None)
            if backend:
                backend.unload_model()
                return True
            return False

    def unload_all(self) -> None:
        with self._lock:
            for key in list(self._loaded.keys()):
                self._loaded.pop(key).unload_model()

    def get_status(self) -> list[dict]:
        result = []
        for name in list_backend_names():
            loaded_models = [
                path for (bname, path) in self._loaded if bname == name
            ]
            result.append(
                {
                    "name": name,
                    "available": True,
                    "loaded_model": loaded_models[0] if loaded_models else None,
                    "device": settings.device if loaded_models else None,
                }
            )
        return result

    def get_backend_status(self, name: str) -> dict:
        loaded_models = [
            path for (bname, path) in self._loaded if bname == name
        ]
        return {
            "name": name,
            "available": name in list_backend_names(),
            "loaded_model": loaded_models[0] if loaded_models else None,
            "device": settings.device if loaded_models else None,
        }


model_manager = ModelManager()
