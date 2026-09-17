import threading
import time

import numpy as np
import pytest

from src.backends import base, registry
from src.config import settings
from src.services.model_manager import ModelManager

TIMEOUT = 5.0


class _SlowBackend(base.TTSBackend):
    name = "slow-test"
    # A generation parks here until the test releases it, so the interleaving these tests
    # depend on is a barrier rather than a delay a loaded machine is free to reorder.
    entered = threading.Event()
    release = threading.Event()

    def load_model(self, model_path, device):
        self._model = object()

    def _generate(self, params):
        self.entered.set()
        while not self.release.wait(0.01):
            self._assert_still_loaded()
        self._assert_still_loaded()
        return base.TTSResult(audio=np.zeros(100, dtype=np.float32), sample_rate=24000)

    def _assert_still_loaded(self):
        if self._model is None:
            raise AssertionError("model was unloaded mid-generation")


@pytest.fixture
def manager(monkeypatch):
    monkeypatch.setitem(registry._BACKENDS, _SlowBackend.name, _SlowBackend)
    monkeypatch.setattr(settings, "max_loaded_models", 2)
    _SlowBackend.entered.clear()
    _SlowBackend.release.clear()
    yield ModelManager()
    # A failed assertion must not leave a parked generation behind.
    _SlowBackend.release.set()


def _wait_until(predicate):
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


# Thread.join(timeout) returns whether or not the thread ended, so a generation parked
# for good would otherwise read as a pass.
def _join(*threads):
    for thread in threads:
        thread.join(TIMEOUT)
        assert not thread.is_alive(), "a generation never finished"


def _checked_out(manager, *paths):
    return {(_SlowBackend.name, p) for p in paths} <= set(manager._in_use)


def _generation(manager, path, errors):
    def run():
        try:
            manager.generate(_SlowBackend.name, path, base.GenerateParams(text="x"))
        except Exception as e:
            errors.append(f"{path}: {e}")

    return threading.Thread(target=run)


def test_a_model_in_use_is_not_evicted(manager):
    errors: list[str] = []
    busy = [_generation(manager, p, errors) for p in ("a", "b")]
    for thread in busy:
        thread.start()
    # Both slots are provably held before the third model asks for one; evicting either
    # would free the tensors of a generation still running on it.
    assert _wait_until(lambda: _checked_out(manager, "a", "b"))

    third = _generation(manager, "c", errors)
    third.start()
    assert _wait_until(lambda: _checked_out(manager, "a", "b", "c"))
    assert len(manager._loaded) == 3

    _SlowBackend.release.set()
    _join(*busy, third)
    assert errors == []


def test_the_cap_is_enforced_again_once_generations_finish(manager):
    errors: list[str] = []
    threads = [_generation(manager, p, errors) for p in ("a", "b", "c")]
    for thread in threads:
        thread.start()
    assert _wait_until(lambda: _checked_out(manager, "a", "b", "c"))

    _SlowBackend.release.set()
    _join(*threads)
    assert errors == []
    assert not manager._in_use
    # Trimmed when the last generation released, not merely on the next cache miss.
    assert len(manager._loaded) == settings.max_loaded_models


def test_unload_refuses_a_model_that_is_generating(manager):
    errors: list[str] = []
    worker = _generation(manager, "a", errors)
    worker.start()
    assert _SlowBackend.entered.wait(TIMEOUT)

    with pytest.raises(RuntimeError, match="cannot be unloaded"):
        manager.unload(_SlowBackend.name, "a")

    _SlowBackend.release.set()
    _join(worker)
    assert errors == []
    assert manager.unload(_SlowBackend.name, "a") is True
