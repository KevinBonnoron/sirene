from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    backend: str
    text: str
    model_path: str
    voice_path: str | None = None
    reference_audio: list[str] | str | None = None
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


class ModelPullRequest(BaseModel):
    url: str
    dest_path: str
    files: list[str]
    total_size: int


class ModelUnloadRequest(BaseModel):
    backend: str
    model_path: str
