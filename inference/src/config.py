from pathlib import Path

from pydantic_settings import BaseSettings

# Project root: inference/src/config.py -> inference/src -> inference -> project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    models_path: str = str(_PROJECT_ROOT / "data" / "models")
    device: str = "cuda"
    max_loaded_models: int = 2
    log_level: str = "info"
    cache_dir: str = str(_PROJECT_ROOT / "data" / "cache" / "prompts")
    cache_max_disk_mb: int = 2048
    auth_token: str = ""
    model_config = {"env_prefix": "INFERENCE_"}


settings = Settings()
