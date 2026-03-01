from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    backend: str
    text: str
    model_path: str
    voice_path: str | None = None
    reference_audio: list[str] | str | None = None
    reference_audio_data: list[str] | None = None  # base64 data URIs, e.g. "data:audio/wav;base64,..."
    reference_cache_key: str | None = None
    reference_text: list[str] | str | None = None
    instruct_text: str | None = None
    instruct_gender: str | None = None
    speed: float = Field(default=1.0, ge=0.1, le=5.0)
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
