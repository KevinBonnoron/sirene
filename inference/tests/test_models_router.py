import asyncio

import pytest
from fastapi import HTTPException

from src.config import settings
from src.routers import models


@pytest.fixture
def models_path(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "models_path", str(tmp_path))
    return tmp_path


def _installed(models_path):
    return asyncio.run(models.list_models())["installed"]


def test_a_directory_holding_a_model_file_is_installed(models_path):
    model = (
        models_path / "piper-fr_FR-siwis-medium" / "fr" / "fr_FR" / "siwis" / "medium"
    )
    model.mkdir(parents=True)
    (model / "fr_FR-siwis-medium.onnx").write_bytes(b"x")
    assert _installed(models_path) == ["piper-fr_FR-siwis-medium"]


def test_an_empty_directory_is_not_installed(models_path):
    (models_path / "piper-en_US-pda-medium").mkdir()
    assert _installed(models_path) == []


def test_a_directory_of_empty_directories_is_not_installed(models_path):
    (models_path / "half-pulled" / "en" / "US").mkdir(parents=True)
    assert _installed(models_path) == []


def test_a_staging_directory_is_never_installed(models_path):
    staging = models_path / ".piper-x.import-abcd1234"
    staging.mkdir()
    (staging / "x.onnx").write_bytes(b"x")
    assert _installed(models_path) == []


def test_a_missing_models_path_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "models_path", str(tmp_path / "nope"))
    assert asyncio.run(models.list_models())["installed"] == []


def test_publishing_over_the_residue_of_a_failed_write_succeeds(models_path):
    residue = models_path / "en_US-hal-medium"
    (residue / "en" / "US").mkdir(parents=True)
    assert not models.holds_a_model(residue)

    staging = models_path / ".en_US-hal-medium.import-abcd1234"
    staging.mkdir()
    (staging / "hal.onnx").write_bytes(b"onnx")

    assert asyncio.run(models._publish(staging, residue)) is True
    assert (residue / "hal.onnx").is_file()
    assert not staging.exists()


def test_publishing_never_overwrites_a_real_model(models_path):
    existing = models_path / "piper-fr_FR-siwis-medium"
    existing.mkdir()
    (existing / "siwis.onnx").write_bytes(b"the real one")

    staging = models_path / ".piper-fr_FR-siwis-medium.pull-abcd1234"
    staging.mkdir()
    (staging / "siwis.onnx").write_bytes(b"a concurrent pull")

    assert asyncio.run(models._publish(staging, existing)) is False
    assert (existing / "siwis.onnx").read_bytes() == b"the real one"
    assert not staging.exists()


def _publish(staging, model_dir):
    return asyncio.run(models._publish(staging, model_dir))


def test_publishing_onto_a_regular_file_is_a_conflict(models_path):
    staging = models_path / ".stage.import-abcd1234"
    staging.mkdir()
    (staging / "m.onnx").write_bytes(b"x")
    blocked = models_path / "blocked"
    blocked.write_text("not a directory")
    assert _publish(staging, blocked) is False
    assert blocked.read_text() == "not a directory"


def test_publishing_onto_a_symlink_is_a_conflict(models_path):
    staging = models_path / ".stage.import-abcd1234"
    staging.mkdir()
    (staging / "m.onnx").write_bytes(b"x")
    elsewhere = models_path / "elsewhere"
    elsewhere.mkdir()
    link = models_path / "linked"
    link.symlink_to(elsewhere)
    assert _publish(staging, link) is False
    assert link.is_symlink()


def test_publishing_onto_a_free_name_succeeds(models_path):
    staging = models_path / ".stage.import-abcd1234"
    staging.mkdir()
    (staging / "m.onnx").write_bytes(b"x")
    target = models_path / "fresh"
    assert _publish(staging, target) is True
    assert (target / "m.onnx").read_bytes() == b"x"


@pytest.mark.parametrize(
    "voice,expected",
    [("fr-fr", "fr_FR"), ("en-gb", "en_GB"), ("fr", "fr"), ("cmn", "cmn")],
)
def test_a_well_formed_espeak_voice_becomes_a_locale(voice, expected):
    assert models.locale_of(voice) == expected


@pytest.mark.parametrize(
    "voice",
    ["x/../../outside", "../etc", ".", "..", "fr/fr", "", "fr-fr/x", "a" * 40],
)
def test_an_espeak_voice_that_could_escape_the_models_path_is_rejected(voice):
    with pytest.raises(HTTPException) as raised:
        models.locale_of(voice)
    assert raised.value.status_code == 400


@pytest.mark.parametrize(
    "model_id",
    [
        "..",
        ".",
        "../outside",
        "a/b",
        "",
        "x" * 129,
        ".hidden",
        ".piper-x.import-abcd1234",
    ],
)
def test_a_model_id_that_could_escape_the_store_is_rejected(models_path, model_id):
    with pytest.raises(HTTPException) as raised:
        models.model_dir_for(model_id)
    assert raised.value.status_code == 400


def test_a_plain_model_id_resolves_inside_the_store(models_path):
    assert (
        models.model_dir_for("piper-fr_FR-siwis-medium")
        == models_path / "piper-fr_FR-siwis-medium"
    )


def test_a_pull_whose_directory_is_taken_reports_an_error(models_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    taken = models_path / "piper-fr_FR-siwis-medium"
    taken.mkdir()
    (taken / "existing.onnx").write_bytes(b"x")

    async def fake_download(model_path, files, total_size, **kwargs):
        model_path.mkdir(parents=True, exist_ok=True)
        (model_path / "new.onnx").write_bytes(b"y")
        yield {"status": "downloading", "progress": 100}

    monkeypatch.setattr(models, "download_model_files", fake_download)
    app = FastAPI()
    app.include_router(models.router)

    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/models/pull",
            json={
                "backend": "piper",
                "model_id": "piper-fr_FR-siwis-medium",
                "files": [],
                "total_size": 1,
            },
        ) as response:
            body = "".join(chunk for chunk in response.iter_text())

    assert '"status": "error"' in body
    assert "already taken" in body
    assert (taken / "existing.onnx").exists()


def test_a_publication_error_names_the_cause_not_the_staging_path(
    models_path, monkeypatch
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    async def fake_download(model_path, files, total_size, **kwargs):
        model_path.mkdir(parents=True, exist_ok=True)
        (model_path / "new.onnx").write_bytes(b"y")
        yield {"status": "downloading", "progress": 100}

    async def refuse(staging, model_dir):
        raise OSError(39, "Directory not empty", str(staging))

    monkeypatch.setattr(models, "download_model_files", fake_download)
    monkeypatch.setattr(models, "_publish", refuse)
    app = FastAPI()
    app.include_router(models.router)

    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/models/pull",
            json={
                "backend": "piper",
                "model_id": "piper-fr_FR-siwis-medium",
                "files": [],
                "total_size": 1,
            },
        ) as response:
            body = "".join(chunk for chunk in response.iter_text())

    assert "Directory not empty" in body
    assert ".import-" not in body
    assert str(models_path) not in body
