from .base import TTSBackend
from .chatterbox import ChatterboxBackend
from .cosyvoice import CosyVoiceBackend
from .fish_audio import FishAudioBackend
from .kokoro import KokoroBackend
from .qwen import QwenBackend
from .f5tts import F5TTSBackend
from .piper import PiperBackend
from .higgs_audio import HiggsAudioBackend

_BACKENDS: dict[str, type[TTSBackend]] = {
    "kokoro": KokoroBackend,
    "qwen": QwenBackend,
    "f5tts": F5TTSBackend,
    "piper": PiperBackend,
    "cosyvoice": CosyVoiceBackend,
    "fish_audio": FishAudioBackend,
    "chatterbox": ChatterboxBackend,
    "higgs_audio": HiggsAudioBackend,
}


def get_backend_class(name: str) -> type[TTSBackend]:
    cls = _BACKENDS.get(name)
    if cls is None:
        raise ValueError(f"Unknown backend: {name!r}. Available: {list(_BACKENDS)}")
    return cls


def list_backend_names() -> list[str]:
    return list(_BACKENDS.keys())
