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
# torch/torchaudio/torchvision share native bindings (torchvision::nms is bound to a libtorch ABI);
# vllm 0.18.0 pulls torchvision 0.25, which pairs only with torch 2.10.
_TORCH = ["torch>=2.10.0,<2.11", "torchaudio>=2.10.0,<2.11", "torchvision>=0.25.0,<0.26"]
# transformers 5 dropped the top-level AutoProcessor export the backends import.
_TRANSFORMERS = "transformers>=4.47.0,<5"
_TRANSFORMERS_FISH = "transformers>=4.47.0,<=4.57.3"


@dataclass
class BackendDeps:
    check_modules: list[str]
    packages: list[str] = field(default_factory=list)
    extra_index_url: str | None = None
    # module:attribute pairs that only a recent enough release provides
    check_symbols: list[str] = field(default_factory=list)


# pip --target is not concurrency-safe: two backends writing the same package left a half-written transformers.
_install_lock = asyncio.Lock()

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
    # torch in check_modules so a partial install (wrapper importable, native deps broken) reads as not installed.
    "qwen": BackendDeps(
        check_modules=["torch", "qwen_tts"],
        packages=[*_TORCH, _TRANSFORMERS, "qwen-tts>=0.1.0"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "f5-tts": BackendDeps(
        check_modules=["torch", "torchaudio", "f5_tts"],
        packages=[*_TORCH, "f5-tts>=1.1.15,<1.2", _TRANSFORMERS, "resemble-perth>=1.0.0", "loralib>=0.1.2", "onnx>=1.17.0,<1.21"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "cosyvoice": BackendDeps(
        check_modules=["torch", "torchaudio", "cosyvoice"],
        packages=[*_TORCH, "cosyvoice>=0.0.8", _TRANSFORMERS, "pyworld>=0.3.4", "wetext>=0.0.4", "pykakasi>=2.0.0", "spacy-pkuseg>=1.0.0", "onnx>=1.17.0,<1.21"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "chatterbox": BackendDeps(
        check_modules=["torch", "torchaudio", "chatterbox"],
        packages=[*_TORCH, _TRANSFORMERS],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "higgs_audio": BackendDeps(
        check_modules=["torch", "boson_multimodal"],
        packages=[*_TORCH, "boson-multimodal>=0.1.0"],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "fish_audio": BackendDeps(
        check_modules=["torch", "torchaudio", "fish_speech"],
        check_symbols=["fish_speech.models.text2semantic.inference:load_codec_model"],
        packages=[
            *_TORCH,
            _TRANSFORMERS_FISH,
            "hydra-core>=1.3.2",
            "omegaconf>=2.3.0",
            "einops>=0.7.0",
            "einx[torch]==0.2.2",
            "loguru>=0.6.0",
            "tiktoken>=0.8.0",
            "safetensors",
            "loralib>=0.1.2",
            "rich>=13.5.3",
            "natsort>=8.4.0",
            "pyrootutils>=1.0.4",
            "descript-audio-codec",
            "descript-audiotools",
        ],
        extra_index_url=_TORCH_CPU_INDEX,
    ),
    "voxtral": BackendDeps(
        check_modules=["vllm", "vllm_omni", "soundfile"],
        packages=["vllm>=0.18.0", "soundfile>=0.12.0"],
    ),
}


_PIP_REASONS = (
    ("No space left on device", "no space left on the inference server's disk (PACKAGES_DIR volume)"),
    ("No matching distribution", "no compatible package found for this Python or platform"),
    ("Could not find a version", "no compatible package found for this Python or platform"),
    ("Temporary failure in name resolution", "network unreachable from the inference server"),
    ("Read timed out", "network timeout while downloading packages"),
    ("ResolutionImpossible", "dependency conflict between installed backends"),
)


def summarize_pip_error(stderr: str) -> str:
    for needle, reason in _PIP_REASONS:
        if needle in stderr:
            return reason
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    for ln in reversed(lines):
        if ln.startswith("ERROR:") and "Exception:" not in ln:
            return ln[len("ERROR:"):].strip()[:300]
    return (lines[-1] if lines else "unknown error")[:300]


def list_installable_backends() -> list[str]:
    return list(_REGISTRY.keys())


def is_installed(backend_name: str) -> bool:
    deps = _REGISTRY.get(backend_name)
    if deps is None:
        return True
    if not all(importlib.util.find_spec(m) is not None for m in deps.check_modules):
        return False
    for symbol in deps.check_symbols:
        module_name, attr = symbol.split(":")
        try:
            module = importlib.import_module(module_name)
        except Exception:
            return False
        if not hasattr(module, attr):
            return False
    return True


async def install_backend_deps(backend_name: str, device: str = "cpu"):
    async with _install_lock:
        async for event in _install_backend_deps(backend_name, device):
            yield event


async def _install_backend_deps(backend_name: str, device: str):
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
        cmd += ["--target", packages_dir, "--upgrade"]
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
        yield {"status": "error", "message": f"Failed to install {backend_name} dependencies: {summarize_pip_error(error)}"}
        raise RuntimeError(error)

    if packages_dir and packages_dir not in sys.path:
        sys.path.insert(0, packages_dir)
    importlib.invalidate_caches()

    if backend_name == "chatterbox":
        await _install_chatterbox_extras()
    elif backend_name == "cosyvoice":
        await _install_cosyvoice_extras()
    elif backend_name == "fish_audio":
        await _install_fish_audio_extras()
    elif backend_name == "voxtral":
        await _install_voxtral_extras()

    yield {"status": "deps_complete", "message": f"{backend_name} dependencies ready"}


async def _run_pip(*args: str) -> None:
    cmd = [sys.executable, "-m", "pip", *args]
    packages_dir = os.environ.get("PACKAGES_DIR")
    if packages_dir and args and args[0] == "install":
        cmd[3:3] = ["--target", packages_dir, "--upgrade"]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        error = stderr.decode(errors="replace") if stderr else "Unknown error"
        logger.error("pip %s failed: %s", " ".join(args), error)
        raise RuntimeError(error)
    importlib.invalidate_caches()


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


# fish-speech 2.0 only exists as a git tag and pins torch 2.8; --no-deps keeps the one shared torch this env already has.
async def _install_fish_audio_extras() -> None:
    await _run_pip("install", "--no-deps", "git+https://github.com/fishaudio/fish-speech.git@v2.0.0-beta")


async def _install_voxtral_extras() -> None:
    await _run_pip("install", "git+https://github.com/vllm-project/vllm-omni.git")
