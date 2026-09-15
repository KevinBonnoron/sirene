from pathlib import Path

from pydantic_settings import BaseSettings

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
    allow_no_auth: bool = False
    model_config = {"env_prefix": "INFERENCE_"}


settings = Settings()
# A whitespace-only token would pass the check below but never match the stripped header.
settings.auth_token = settings.auth_token.strip()

if not settings.auth_token and not settings.allow_no_auth:
    raise RuntimeError(
        "INFERENCE_AUTH_TOKEN is not set. Either set it to a strong secret or set "
        "INFERENCE_ALLOW_NO_AUTH=true to explicitly opt into unauthenticated mode."
    )
