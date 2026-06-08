from unittest.mock import AsyncMock

import pytest

from codex_auth import CODEX_CHATGPT_BASE_URL, CodexAuthCredentials, CodexAuthError, CodexAuthNotConfigured
from llm import Llm
from routes.generate_code import ParameterExtractionStage


def _valid_request() -> dict[str, object]:
    return {
        "generatedCodeConfig": "html_tailwind",
        "inputMode": "text",
        "prompt": {"text": "hello"},
    }


@pytest.mark.asyncio
async def test_extracts_codex_auth_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_codex_auth_credentials(refresh: bool) -> CodexAuthCredentials:
        assert refresh is True
        return CodexAuthCredentials(
            access_token="access-token",
            account_id="account-id",
            email="user@example.com",
            plan_type="plus",
            is_fedramp_account=False,
        )

    monkeypatch.setattr(
        "routes.generate_code.get_codex_auth_credentials",
        fake_get_codex_auth_credentials,
    )
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(_valid_request())

    assert extracted.openai_api_key == "access-token"
    assert extracted.openai_base_url == CODEX_CHATGPT_BASE_URL
    assert extracted.openai_default_headers["ChatGPT-Account-ID"] == "account-id"
    assert extracted.openai_default_headers["originator"] == "codex_cli_rs"
    assert extracted.anthropic_api_key is None
    assert extracted.gemini_api_key is None
    assert extracted.selected_model == Llm.GPT_5_5_HIGH


@pytest.mark.asyncio
async def test_missing_codex_auth_leaves_openai_token_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get_codex_auth_credentials(refresh: bool) -> CodexAuthCredentials:
        raise CodexAuthNotConfigured("not connected")

    monkeypatch.setattr(
        "routes.generate_code.get_codex_auth_credentials",
        fake_get_codex_auth_credentials,
    )
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(_valid_request())

    assert extracted.openai_api_key is None
    assert extracted.openai_default_headers == {}
    assert extracted.openai_base_url == CODEX_CHATGPT_BASE_URL
    assert extracted.selected_model == Llm.GPT_5_5_HIGH


@pytest.mark.asyncio
async def test_extracts_selected_codex_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_codex_auth_credentials(refresh: bool) -> CodexAuthCredentials:
        raise CodexAuthNotConfigured("not connected")

    monkeypatch.setattr(
        "routes.generate_code.get_codex_auth_credentials",
        fake_get_codex_auth_credentials,
    )
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            **_valid_request(),
            "codeGenerationModel": "gpt-5.4-mini (xhigh thinking)",
        }
    )

    assert extracted.selected_model == Llm.GPT_5_4_MINI_XHIGH


@pytest.mark.asyncio
async def test_ignores_unsupported_selected_codex_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get_codex_auth_credentials(refresh: bool) -> CodexAuthCredentials:
        raise CodexAuthNotConfigured("not connected")

    monkeypatch.setattr(
        "routes.generate_code.get_codex_auth_credentials",
        fake_get_codex_auth_credentials,
    )
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            **_valid_request(),
            "codeGenerationModel": "gpt-5.5 (no thinking)",
        }
    )

    assert extracted.selected_model == Llm.GPT_5_5_HIGH


@pytest.mark.asyncio
async def test_invalid_codex_auth_reports_actionable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get_codex_auth_credentials(refresh: bool) -> CodexAuthCredentials:
        raise CodexAuthError("invalid token")

    throw_error = AsyncMock()
    monkeypatch.setattr(
        "routes.generate_code.get_codex_auth_credentials",
        fake_get_codex_auth_credentials,
    )
    stage = ParameterExtractionStage(throw_error)

    with pytest.raises(ValueError, match="Invalid Codex auth"):
        await stage.extract_and_validate(_valid_request())

    throw_error.assert_awaited_once_with(
        "Codex account login is invalid or expired. Open Settings and sign in with ChatGPT again."
    )


@pytest.mark.asyncio
async def test_extracts_design_system_from_request(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_codex_auth_credentials(refresh: bool) -> CodexAuthCredentials:
        raise CodexAuthNotConfigured("not connected")

    monkeypatch.setattr(
        "routes.generate_code.get_codex_auth_credentials",
        fake_get_codex_auth_credentials,
    )
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_css",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "designSystem": "  Reuse .mockup-frame  ",
        }
    )

    assert extracted.design_system == "Reuse .mockup-frame"
