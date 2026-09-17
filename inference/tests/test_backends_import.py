import importlib
import pkgutil

import pytest

from src.backends import registry

# Backend modules import their heavy dependencies lazily, inside the methods that need
# them, so the whole package must import on the base install alone. Losing that means a
# worker that cannot even list its backends until torch is installed.


def test_every_registered_backend_class_is_importable():
    for name in registry.list_backend_names():
        assert registry.get_backend_class(name).name


def test_every_backend_module_imports_without_its_runtime_deps():
    package = importlib.import_module("src.backends")
    for module in pkgutil.iter_modules(package.__path__):
        importlib.import_module(f"src.backends.{module.name}")


def test_the_app_imports():
    importlib.import_module("src.main")


def test_an_unknown_backend_is_rejected():
    with pytest.raises(ValueError, match="Unknown backend"):
        registry.get_backend_class("nope")
