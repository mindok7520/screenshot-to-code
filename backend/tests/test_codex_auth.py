import base64
import json
from pathlib import Path
from typing import Any, cast

import pytest

from codex_auth import (
    CODEX_CHATGPT_BASE_URL,
    _callback_bind_host,
    get_codex_auth_credentials,
    get_codex_auth_status,
    list_codex_models,
    logout_codex_auth,
)


def _jwt(payload: dict[str, object]) -> str:
    def encode(part: dict[str, object]) -> str:
        raw = json.dumps(part, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{encode({'alg': 'none'})}.{encode(payload)}.sig"


def _write_codex_auth(codex_home: Path) -> None:
    codex_home.mkdir(parents=True)
    id_token = _jwt(
        {
            "email": "user@example.com",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "account-id",
                "chatgpt_plan_type": "plus",
                "chatgpt_account_is_fedramp": False,
            },
        }
    )
    access_token = _jwt({"exp": 4_102_444_800})
    (codex_home / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "OPENAI_API_KEY": None,
                "tokens": {
                    "id_token": id_token,
                    "access_token": access_token,
                    "refresh_token": "refresh-token",
                    "account_id": "account-id",
                },
                "last_refresh": "2026-01-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )


def test_codex_auth_status_reads_chatgpt_login(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    codex_home = tmp_path / ".codex"
    _write_codex_auth(codex_home)
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    status = get_codex_auth_status(refresh=True)

    assert status.authenticated is True
    assert status.codex_home == str(codex_home)
    assert status.email == "user@example.com"
    assert status.account_id == "account-id"
    assert status.plan_type == "plus"


def test_codex_credentials_build_openai_headers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    codex_home = tmp_path / ".codex"
    _write_codex_auth(codex_home)
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    credentials = get_codex_auth_credentials(refresh=True)

    assert credentials.access_token
    assert credentials.account_id == "account-id"
    assert credentials.openai_default_headers() == {
        "ChatGPT-Account-ID": "account-id",
        "originator": "codex_cli_rs",
        "User-Agent": "codex_cli_rs/0.128.0",
        "version": "0.128.0",
    }
    assert CODEX_CHATGPT_BASE_URL == "https://chatgpt.com/backend-api/codex"


def test_codex_callback_bind_host_is_configurable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CODEX_AUTH_CALLBACK_BIND_HOST", raising=False)
    assert _callback_bind_host() == "127.0.0.1"

    monkeypatch.setenv("CODEX_AUTH_CALLBACK_BIND_HOST", "0.0.0.0")
    assert _callback_bind_host() == "0.0.0.0"


def test_codex_models_filters_to_chatgpt_response_models(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    codex_home = tmp_path / ".codex"
    _write_codex_auth(codex_home)
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {
                "models": [
                    {
                        "slug": "gpt-5.3-codex",
                        "display_name": "GPT 5.3 Codex",
                        "description": "Should not be exposed for ChatGPT accounts.",
                        "supported_in_api": True,
                        "visibility": "list",
                        "default_reasoning_level": "xhigh",
                        "supported_reasoning_levels": [
                            {"effort": "high", "description": "High"},
                            {"effort": "xhigh", "description": "XHigh"},
                        ],
                    },
                    {
                        "slug": "gpt-5.5",
                        "display_name": "GPT 5.5",
                        "description": "Main model",
                        "supported_in_api": True,
                        "visibility": "list",
                        "default_reasoning_level": "none",
                        "supported_reasoning_levels": [
                            {"effort": "none", "description": "None"},
                            {"effort": "medium", "description": "Medium"},
                            {"effort": "high", "description": "High"},
                            {"effort": "xhigh", "description": "XHigh"},
                        ],
                    },
                    {
                        "slug": "gpt-5.4-mini",
                        "display_name": "GPT 5.4 Mini",
                        "description": "Fast model",
                        "supported_in_api": True,
                        "visibility": "list",
                        "default_reasoning_level": "high",
                        "supported_reasoning_levels": [
                            {"effort": "low", "description": "Low"},
                            {"effort": "high", "description": "High"},
                        ],
                    },
                ]
            }

    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        captured["url"] = url
        captured["kwargs"] = kwargs
        return FakeResponse()

    monkeypatch.setattr("codex_auth.httpx.get", fake_get)

    models = list_codex_models()

    assert captured["url"] == f"{CODEX_CHATGPT_BASE_URL}/models"
    kwargs = cast(dict[str, Any], captured["kwargs"])
    headers = cast(dict[str, str], kwargs["headers"])
    assert str(headers["Authorization"]).startswith("Bearer ")
    assert [model.slug for model in models] == ["gpt-5.5", "gpt-5.4-mini"]
    assert [level.effort for level in models[0].supported_reasoning_levels] == [
        "medium",
        "high",
        "xhigh",
    ]
    assert models[0].default_reasoning_effort is None


def test_codex_logout_removes_auth_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    codex_home = tmp_path / ".codex"
    _write_codex_auth(codex_home)
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    logout_codex_auth()

    assert not (codex_home / "auth.json").exists()
