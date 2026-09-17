import logging
import threading
from collections import Counter, OrderedDict
from contextlib import contextmanager
from pathlib import Path

from ..backends.base import GenerateParams, TTSBackend, TTSResult, GENERATION_LOCK
from ..backends.registry import get_backend_class, list_backend_names
from ..config import settings

logger = logging.getLogger(__name__)


class ModelManager:

    def __init__(self):
        self._loaded: OrderedDict[tuple[str, str], TTSBackend] = OrderedDict()
        self._lock = threading.Lock()
        self._in_use: Counter[tuple[str, str]] = Counter()

    def generate(
        self, backend_name: str, model_path: str, params: GenerateParams
    ) -> TTSResult:
        with self._checkout(backend_name, model_path) as backend:
            with GENERATION_LOCK:
                return backend.generate(params)

    def generate_stream(
        self, backend_name: str, model_path: str, params: GenerateParams
    ):
        with self._checkout(backend_name, model_path) as backend:
            if not backend.supports_streaming():
                raise ValueError(f"Backend {backend_name!r} does not support streaming")
            with GENERATION_LOCK:
                yield from backend.generate_stream(params)

    def get_backend(self, backend_name: str, model_path: str) -> TTSBackend:
        return self._get_or_load(backend_name, model_path)

    # GENERATION_LOCK serialises sampling but not loading, so without this a request for a
    # third model would evict — and unload_model() — a backend another thread is generating
    # on, freeing tensors from under it.
    @contextmanager
    def _checkout(self, backend_name: str, model_path: str):
        key = (backend_name, model_path)
        backend = self._get_or_load(backend_name, model_path, hold=True)
        try:
            yield backend
        finally:
            with self._lock:
                self._in_use[key] -= 1
                if self._in_use[key] <= 0:
                    del self._in_use[key]
                # The cap can have been exceeded while every model was busy; this is the
                # first moment one of them is free to go.
                self._evict_idle(reserve=0)

    def _get_or_load(
        self, backend_name: str, model_path: str, hold: bool = False
    ) -> TTSBackend:
        key = (backend_name, model_path)
        with self._lock:
            if key in self._loaded:
                self._loaded.move_to_end(key)
            else:
                self._evict_idle()
                cls = get_backend_class(backend_name)
                backend = cls()
                backend.load_model(Path(model_path), settings.device)
                self._loaded[key] = backend
                logger.info(f"Loaded model: backend={backend_name}, path={model_path}")
            if hold:
                self._in_use[key] += 1
            return self._loaded[key]

    # reserve is the number of slots the caller still needs: one to load a model into,
    # none when it is only giving one back.
    def _evict_idle(self, reserve: int = 1) -> None:
        while len(self._loaded) + reserve > settings.max_loaded_models:
            victim = next((k for k in self._loaded if k not in self._in_use), None)
            if victim is None:
                logger.warning(
                    "Every loaded model is generating; keeping %d loaded rather than "
                    "unloading one mid-generation",
                    len(self._loaded),
                )
                return
            logger.info(f"Evicting model: backend={victim[0]}, path={victim[1]}")
            self._loaded.pop(victim).unload_model()

    def unload(self, backend_name: str, model_path: str) -> bool:
        key = (backend_name, model_path)
        with self._lock:
            if key in self._in_use:
                raise RuntimeError(
                    f"Model {model_path!r} is generating and cannot be unloaded"
                )
            backend = self._loaded.pop(key, None)
            if backend:
                backend.unload_model()
                return True
            return False

    def unload_all(self) -> None:
        with self._lock:
            for key in [k for k in self._loaded if k not in self._in_use]:
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
