import threading
from contextlib import contextmanager

import numpy as np
import pytest

from src.backends.base import GenerateParams, TTSBackend, TTSResult
from src.services.model_manager import ModelManager

# How long a generation waits for the others to join it before concluding it is alone.
RENDEZVOUS = 0.4
# A locking regression must fail the test, not hang the suite waiting on a stuck worker.
JOIN_TIMEOUT = 5.0


class Concurrency:
    """Highest number of generations that were inside _generate at the same moment."""

    def __init__(self, expected: int):
        self._lock = threading.Lock()
        self._inside = threading.Barrier(expected)
        self.active = 0
        self.peak = 0

    @contextmanager
    def track(self):
        with self._lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            # Whoever is allowed to run together meets here; a serialised one waits alone
            # and gives up, which is the observation the test is after.
            try:
                self._inside.wait(timeout=RENDEZVOUS)
            except threading.BrokenBarrierError:
                pass
            yield
        finally:
            with self._lock:
                self.active -= 1


class SlowBackend(TTSBackend):
    name = "slow"

    def __init__(self, tracker: Concurrency, samples_locally: bool = True):
        super().__init__()
        self.samples_locally = samples_locally
        self.tracker = tracker
        self._model = True

    def load_model(self, model_path, device):  # pragma: no cover - never loaded here
        self._model = True

    def is_loaded(self) -> bool:
        return True

    def supports_streaming(self) -> bool:
        return False

    def _generate(self, params: GenerateParams) -> TTSResult:
        with self.tracker.track():
            return TTSResult(audio=np.zeros(10, dtype="float32"), sample_rate=24000)


def _peak(manager: ModelManager, backends, seeds) -> int:
    """Runs every generation at once and reports how many ever overlapped."""

    def one(index):
        params = GenerateParams(text="hello", seed=seeds[index])
        with manager._exclusive(backends[index], params):
            backends[index].generate(params)

    threads = [
        threading.Thread(target=one, args=(i,), daemon=True) for i in range(len(seeds))
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=JOIN_TIMEOUT)
    stuck = [t.name for t in threads if t.is_alive()]
    assert not stuck, f"generation never returned: {stuck}"
    return backends[0].tracker.peak


def _backends(count: int, samples_locally: bool = True):
    tracker = Concurrency(count)
    return [SlowBackend(tracker, samples_locally) for _ in range(count)]


@pytest.fixture
def manager():
    return ModelManager()


def test_two_unseeded_takes_on_different_models_run_at_once(manager):
    assert _peak(manager, _backends(2), [None, None]) == 2


def test_three_unseeded_takes_on_three_models_all_run_at_once(manager):
    assert _peak(manager, _backends(3), [None, None, None]) == 3


def test_two_unseeded_takes_on_one_model_take_turns(manager):
    shared = _backends(2)[0]
    assert _peak(manager, [shared, shared], [None, None]) == 1


def test_two_seeded_takes_take_turns_even_on_different_models(manager):
    assert _peak(manager, _backends(2), [1, 2]) == 1


def test_an_unseeded_take_never_overlaps_a_seeded_one(manager):
    # Unseeded sampling draws from the RNG stream a seeded take just set, so overlapping
    # would make the seeded take's output depend on the interleaving.
    assert _peak(manager, _backends(2), [1, None]) == 1


def test_a_backend_that_samples_elsewhere_never_waits(manager):
    # One instance, so the test still fails if the remote path took the per-model lock.
    remote = _backends(2, samples_locally=False)[0]
    assert _peak(manager, [remote, remote], [1, 2]) == 2
