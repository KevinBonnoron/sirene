import asyncio
import importlib
import importlib.util
import logging
import os
import shutil
import sys
import sysconfig
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

_TORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"
_TORCH = ["torch>=2.5.0,<2.8", "torchaudio>=2.5.0,<2.8"]
_TORCH_28 = ["torch==2.8.0", "torchaudio==2.8.0"]


@dataclass
class BackendDeps:
    # All modules must be importable for the backend to be considered installed
    check_modules: list[str]
    packages: list[str] = field(default_factory=list)
    # Extra PyPI index (e.g. CPU torch wheel)
    extra_index_url: str | None = None


_REGISTRY: dict[str, BackendDeps] = {
    "whisper": BackendDeps(
        check_modules=["faster_whisper"],
        packages=["faster-whisper>=1.1.0"],
    ),
    "piper": BackendDeps(
        check_modules=["onnxruntime"],
        packages=["onnxruntime>=1.20.0"],
    ),
    "kokoro": BackendDeps(
        check_modules=["onnxruntime", "misaki.en"],
        packages=["onnxruntime>=1.20.0", "misaki[en,zh]>=0.7.0"],
    ),
    "qwen": BackendDeps(
        check_modules=["qwen_tts"],
        packages=[*_TORCH, "transformers>=4.47.0", "qwen-tts>=0.1.0"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "f5-tts": BackendDeps(
        check_modules=["f5_tts"],
        packages=[*_TORCH, "f5-tts>=1.1.15,<1.2", "transformers>=4.47.0", "resemble-perth>=1.0.0", "loralib>=0.1.2", "onnx>=1.17.0,<1.21"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "cosyvoice": BackendDeps(
        check_modules=["cosyvoice"],
        packages=[*_TORCH, "cosyvoice>=0.0.8", "transformers>=4.47.0", "pyworld>=0.3.4", "wetext>=0.0.4", "pykakasi>=2.0.0", "spacy-pkuseg>=1.0.0", "onnx>=1.17.0,<1.21"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "chatterbox": BackendDeps(
        check_modules=["chatterbox"],
        packages=[*_TORCH, "transformers>=4.47.0"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "higgs_audio": BackendDeps(
        check_modules=["boson_multimodal"],
        packages=[*_TORCH, "boson-multimodal>=0.1.0"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "fish_audio": BackendDeps(
        check_modules=["fish_speech"],
        packages=[
            *_TORCH_28,
            "transformers<=4.57.3",
            "hydra-core>=1.3.2",
            "loguru>=0.6.0",
            "tiktoken>=0.8.0",
            "safetensors",
            "einx[torch]==0.2.2",
            "loralib>=0.1.2",
            "rich>=13.5.3",
            "natsort>=8.4.0",
            "pyrootutils>=1.0.4",
        ],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
}


def list_installable_backends() -> list[str]:
    return list(_REGISTRY.keys())


def is_installed(backend_name: str) -> bool:
    deps = _REGISTRY.get(backend_name)
    if deps is None:
        return True
    return all(importlib.util.find_spec(m) is not None for m in deps.check_modules)


async def install_backend_deps(backend_name: str, device: str = "cpu"):
    """Async generator yielding SSE-compatible progress dicts."""
    deps = _REGISTRY.get(backend_name)
    if deps is None or is_installed(backend_name):
        return

    yield {"status": "installing_deps", "message": f"Installing {backend_name} dependencies..."}

    packages = list(deps.packages)

    if device == "cuda":
        packages = [
            "onnxruntime-gpu>=1.20.0" if p.startswith("onnxruntime>=") else p
            for p in packages
        ]

    packages_dir = os.environ.get("PACKAGES_DIR")

    cmd = [sys.executable, "-m", "pip", "install"]
    if packages_dir:
        cmd += ["--target", packages_dir]
    if device == "cpu" and deps.extra_index_url:
        cmd += ["--extra-index-url", deps.extra_index_url]
    cmd += packages

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        error = stderr.decode(errors="replace") if stderr else "Unknown error"
        logger.error("pip install failed for %s: %s", backend_name, error)
        yield {"status": "error", "message": f"Failed to install {backend_name} dependencies: {error[-1000:]}"}
        raise RuntimeError(error)

    # Make newly installed packages importable in the current process
    if packages_dir and packages_dir not in sys.path:
        sys.path.insert(0, packages_dir)
    importlib.invalidate_caches()

    # Post-install steps for backends with non-PyPI extras
    if backend_name == "chatterbox":
        await _install_chatterbox_extras()
    elif backend_name == "cosyvoice":
        await _install_cosyvoice_extras()
    elif backend_name == "fish_audio":
        await _install_fish_audio_extras()

    yield {"status": "deps_complete", "message": f"{backend_name} dependencies ready"}


async def _run_pip(*args: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "pip", *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.communicate()


async def _install_chatterbox_extras() -> None:
    await _run_pip("install", "--no-deps", "chatterbox-tts", "s3tokenizer")
    await _run_pip(
        "install",
        "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
    )


async def _install_cosyvoice_extras() -> None:
    site_pkg = Path(sysconfig.get_path("purelib"))
    tmpdir = tempfile.mkdtemp()
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth=1", "--recursive", "--filter=blob:none",
            "https://github.com/FunAudioLLM/CosyVoice.git", tmpdir,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.communicate()

        for src, dst in [
            (Path(tmpdir) / "cosyvoice", site_pkg / "cosyvoice"),
            (Path(tmpdir) / "third_party" / "Matcha-TTS" / "matcha", site_pkg / "matcha"),
        ]:
            if src.exists():
                dst.mkdir(exist_ok=True)
                shutil.copytree(src, dst, dirs_exist_ok=True)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    await _run_pip(
        "install",
        "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
    )



async def _install_fish_audio_extras() -> None:
    # TODO: replace with `"fish-speech==2.0.0"` in packages once stable is on PyPI
    await _run_pip(
        "install", "--no-deps",
        "git+https://github.com/fishaudio/fish-speech.git@v2.0.0-beta",
    )
