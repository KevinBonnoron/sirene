from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    backend: str
    text: str
    model_path: str
    voice_path: str | None = None
    reference_audio: list[str] | str | None = None
    reference_audio_data: list[str] | None = None
    reference_cache_key: str | None = None
    reference_text: list[str] | str | None = None
    instruct_text: str | None = None
    instruct_gender: str | None = None
    speed: float = Field(default=1.0, ge=0.1, le=5.0)
    pitch_shift: float = Field(default=0.0, ge=-12.0, le=12.0)
    noise_scale: float | None = Field(default=None, ge=0.0, le=2.0)
    seed: int | None = Field(default=None, ge=0, le=2**63 - 1)
    language: str = "en"


class BackendStatus(BaseModel):
    name: str
    available: bool
    loaded_model: str | None = None
    device: str | None = None


class ModelPullFile(BaseModel):
    url: str
    path: str


class ModelPullRequest(BaseModel):
    backend: str
    model_id: str
    files: list[ModelPullFile]
    total_size: int
    hf_token: str | None = None


class ModelUnloadRequest(BaseModel):
    backend: str
    model_path: str
