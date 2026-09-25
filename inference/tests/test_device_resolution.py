import sys
import types

import pytest

from src.backends.base import TTSBackend


class FakeTorch(types.ModuleType):
    def __init__(self, cuda_ok=False, mps_ok=False, allocates=True):
        super().__init__("torch")
        self.cuda = types.SimpleNamespace(is_available=lambda: cuda_ok)
        self.backends = types.SimpleNamespace(
            mps=types.SimpleNamespace(is_available=lambda: mps_ok)
        )
        self._allocates = allocates

    def zeros(self, *_args, **_kwargs):
        if not self._allocates:
            raise RuntimeError("out of memory")
        return object()


@pytest.fixture
def torch_module(monkeypatch):
    def install(**kwargs):
        monkeypatch.setitem(sys.modules, "torch", FakeTorch(**kwargs))

    return install


def test_cpu_is_returned_as_is(torch_module):
    torch_module(cuda_ok=True, mps_ok=True)
    assert TTSBackend._resolve_device("cpu") == "cpu"


def test_cuda_is_kept_when_it_allocates(torch_module):
    torch_module(cuda_ok=True)
    assert TTSBackend._resolve_device("cuda") == "cuda"
    assert TTSBackend._resolve_device("cuda:1") == "cuda:1"


def test_cuda_falls_back_when_unavailable(torch_module):
    torch_module(cuda_ok=False)
    assert TTSBackend._resolve_device("cuda") == "cpu"


def test_metal_is_kept_when_it_allocates(torch_module):
    torch_module(mps_ok=True)
    assert TTSBackend._resolve_device("mps") == "mps"


def test_metal_falls_back_when_unavailable(torch_module):
    torch_module(mps_ok=False)
    assert TTSBackend._resolve_device("mps") == "cpu"


def test_a_device_that_reports_available_but_cannot_allocate_falls_back(torch_module):
    torch_module(cuda_ok=True, mps_ok=True, allocates=False)
    assert TTSBackend._resolve_device("cuda") == "cpu"
    assert TTSBackend._resolve_device("mps") == "cpu"


def test_an_unknown_device_is_not_trusted(torch_module):
    torch_module(cuda_ok=True, mps_ok=True)
    assert TTSBackend._resolve_device("rocm") == "cpu"
