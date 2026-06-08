from unittest.mock import AsyncMock

import pytest

from llm import Llm
from routes.generate_code import ModelSelectionStage


class TestModelSelectionCodexOnly:
    def setup_method(self) -> None:
        self.throw_error = AsyncMock()
        self.model_selector = ModelSelectionStage(self.throw_error)

    @pytest.mark.asyncio
    async def test_create_uses_selected_codex_model(self) -> None:
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="codex-token",
            selected_model=Llm.GPT_5_5_XHIGH,
            anthropic_api_key=None,
            gemini_api_key=None,
        )

        assert models == [
            Llm.GPT_5_5_XHIGH,
            Llm.GPT_5_5_XHIGH,
            Llm.GPT_5_5_XHIGH,
            Llm.GPT_5_5_XHIGH,
        ]

    @pytest.mark.asyncio
    async def test_update_uses_two_codex_variants(self) -> None:
        models = await self.model_selector.select_models(
            generation_type="update",
            input_mode="image",
            openai_api_key="codex-token",
            selected_model=Llm.GPT_5_4_MEDIUM,
            anthropic_api_key="ignored",
            gemini_api_key="ignored",
        )

        assert models == [
            Llm.GPT_5_4_MEDIUM,
            Llm.GPT_5_4_MEDIUM,
        ]

    @pytest.mark.asyncio
    async def test_video_uses_codex_models_when_logged_in(self) -> None:
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="video",
            openai_api_key="codex-token",
            selected_model=Llm.GPT_5_4_MINI_HIGH,
            anthropic_api_key=None,
            gemini_api_key=None,
        )

        assert models == [
            Llm.GPT_5_4_MINI_HIGH,
            Llm.GPT_5_4_MINI_HIGH,
            Llm.GPT_5_4_MINI_HIGH,
            Llm.GPT_5_4_MINI_HIGH,
        ]

    @pytest.mark.asyncio
    async def test_no_codex_login_reports_error(self) -> None:
        with pytest.raises(Exception, match="No Codex login"):
            await self.model_selector.select_models(
                generation_type="create",
                input_mode="text",
                openai_api_key=None,
                selected_model=Llm.GPT_5_5_HIGH,
                anthropic_api_key=None,
                gemini_api_key=None,
            )

        self.throw_error.assert_awaited_once_with(
            "No Codex ChatGPT login found. Open Settings and sign in with ChatGPT before generating code."
        )
