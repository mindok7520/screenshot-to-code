import copy
from typing import Any, cast

import pytest

from agent.providers.base import ExecutedToolCall, ProviderTurn
from agent.providers.openai import (
    OpenAIProviderSession,
    OpenAIResponsesParseState,
    _build_provider_turn,
    parse_event,
)
from agent.tools import ToolCall, ToolExecutionResult
from llm import Llm


class _EmptyAsyncStream:
    def __aiter__(self) -> "_EmptyAsyncStream":
        return self

    async def __anext__(self) -> object:
        raise StopAsyncIteration


class _FakeResponses:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> _EmptyAsyncStream:
        self.calls.append(copy.deepcopy(kwargs))
        return _EmptyAsyncStream()


class _FakeOpenAIClient:
    def __init__(self) -> None:
        self.responses = _FakeResponses()

    async def close(self) -> None:
        return None


async def _noop_event_sink(_: Any) -> None:
    return None


def _test_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": "edit_file",
            "description": "Apply an edit.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                },
                "required": ["path"],
            },
            "strict": True,
        }
    ]


@pytest.mark.asyncio
async def test_openai_provider_session_omits_prompt_cache_key_across_turns() -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=Llm.GPT_5_5_HIGH,
        prompt_messages=[{"role": "user", "content": "Build a landing page."}],
        tools=_test_tools(),
    )

    first_turn = await session.stream_turn(_noop_event_sink)
    session.append_tool_results(
        ProviderTurn(
            assistant_text=first_turn.assistant_text,
            tool_calls=[],
            assistant_turn=[
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "edit_file",
                    "arguments": '{"path":"index.html"}',
                }
            ],
        ),
        [
            ExecutedToolCall(
                tool_call=ToolCall(
                    id="call-1",
                    name="edit_file",
                    arguments={"path": "index.html"},
                ),
                result=ToolExecutionResult(
                    ok=True,
                    result={
                        "content": "Successfully edited file at index.html.",
                        "details": {
                            "diff": "--- index.html\n+++ index.html\n@@ -1 +1 @@\n-a\n+b\n",
                            "firstChangedLine": 1,
                        },
                    },
                    summary={"content": "Successfully edited file at index.html."},
                ),
            )
        ],
    )
    await session.stream_turn(_noop_event_sink)

    first_call = client.responses.calls[0]
    second_call = client.responses.calls[1]
    first_input = first_call["input"]
    second_input = second_call["input"]

    assert "prompt_cache_key" not in first_call
    assert "prompt_cache_key" not in second_call
    assert "prompt_cache_retention" not in first_call
    assert "prompt_cache_retention" not in second_call
    assert isinstance(first_input, list)
    assert isinstance(second_input, list)
    assert len(second_input) > len(first_input)
    replayed_function_call = cast(dict[str, Any], second_input[-2])
    assert replayed_function_call == {
        "type": "function_call",
        "call_id": "call-1",
        "name": "edit_file",
        "arguments": '{"path":"index.html"}',
    }


@pytest.mark.asyncio
async def test_openai_provider_session_omits_prompt_cache_key_for_all_prompts() -> None:
    first_client = _FakeOpenAIClient()
    second_client = _FakeOpenAIClient()
    different_prompt_client = _FakeOpenAIClient()

    first_session = OpenAIProviderSession(
        client=first_client,  # type: ignore[arg-type]
        model=Llm.GPT_5_5_HIGH,
        prompt_messages=[{"role": "user", "content": "Build a landing page."}],
        tools=_test_tools(),
    )
    second_session = OpenAIProviderSession(
        client=second_client,  # type: ignore[arg-type]
        model=Llm.GPT_5_5_HIGH,
        prompt_messages=[{"role": "user", "content": "Build a landing page."}],
        tools=_test_tools(),
    )
    different_prompt_session = OpenAIProviderSession(
        client=different_prompt_client,  # type: ignore[arg-type]
        model=Llm.GPT_5_5_HIGH,
        prompt_messages=[{"role": "user", "content": "Build a dashboard."}],
        tools=_test_tools(),
    )

    await first_session.stream_turn(_noop_event_sink)
    await second_session.stream_turn(_noop_event_sink)
    await different_prompt_session.stream_turn(_noop_event_sink)

    assert "prompt_cache_key" not in first_client.responses.calls[0]
    assert "prompt_cache_key" not in second_client.responses.calls[0]
    assert "prompt_cache_key" not in different_prompt_client.responses.calls[0]


@pytest.mark.asyncio
async def test_openai_provider_session_removes_non_replayable_store_false_items() -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=Llm.GPT_5_5_HIGH,
        prompt_messages=[{"role": "user", "content": "Build a page."}],
        tools=_test_tools(),
    )

    session.append_tool_results(
        ProviderTurn(
            assistant_text="",
            tool_calls=[
                ToolCall(
                    id="call-1",
                    name="edit_file",
                    arguments={"path": "index.html"},
                )
            ],
            assistant_turn=[
                {
                    "type": "reasoning",
                    "id": "rs_123",
                    "summary": [{"text": "Planning."}],
                },
                {
                    "type": "function_call",
                    "id": "fc_123",
                    "call_id": "call-1",
                    "name": "edit_file",
                    "arguments": '{"path":"index.html"}',
                    "status": "completed",
                },
            ],
        ),
        [
            ExecutedToolCall(
                tool_call=ToolCall(
                    id="call-1",
                    name="edit_file",
                    arguments={"path": "index.html"},
                ),
                result=ToolExecutionResult(
                    ok=True,
                    result={"content": "ok"},
                    summary={"content": "ok"},
                ),
            )
        ],
    )

    await session.stream_turn(_noop_event_sink)

    input_items = client.responses.calls[0]["input"]
    assert all(item.get("type") != "reasoning" for item in input_items)
    assert all(
        not str(item.get("id", "")).startswith("rs_")
        for item in input_items
        if isinstance(item, dict)
    )
    assert input_items[-2] == {
        "type": "function_call",
        "id": "fc_123",
        "call_id": "call-1",
        "name": "edit_file",
        "arguments": '{"path":"index.html"}',
        "status": "completed",
    }
    assert input_items[-1]["type"] == "function_call_output"


@pytest.mark.asyncio
async def test_openai_provider_turn_replays_tool_call_from_argument_event() -> None:
    state = OpenAIResponsesParseState()

    await parse_event(
        {
            "type": "response.function_call_arguments.done",
            "item_id": "fc_123",
            "call_id": "call-1",
            "name": "edit_file",
            "arguments": '{"path":"index.html"}',
        },
        state,
        _noop_event_sink,
    )

    turn = _build_provider_turn(state)

    assert turn.tool_calls[0].id == "call-1"
    assert turn.assistant_turn == [
        {
            "type": "function_call",
            "id": "fc_123",
            "call_id": "call-1",
            "name": "edit_file",
            "arguments": '{"path":"index.html"}',
        }
    ]


@pytest.mark.asyncio
async def test_openai_provider_session_uses_gpt_5_4_none_reasoning_effort() -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=Llm.GPT_5_4_2026_03_05_NONE,
        prompt_messages=[{"role": "user", "content": "Build a dashboard."}],
        tools=_test_tools(),
    )

    await session.stream_turn(_noop_event_sink)

    first_call = client.responses.calls[0]

    assert first_call["model"] == "gpt-5.4-2026-03-05"
    assert first_call["prompt_cache_retention"] == "24h"
    assert first_call["reasoning"] == {"effort": "none", "summary": "auto"}


@pytest.mark.asyncio
async def test_openai_provider_session_uses_gpt_5_4_high_reasoning_effort() -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=Llm.GPT_5_4_2026_03_05_HIGH,
        prompt_messages=[{"role": "user", "content": "Build a dashboard."}],
        tools=_test_tools(),
    )

    await session.stream_turn(_noop_event_sink)

    first_call = client.responses.calls[0]

    assert first_call["model"] == "gpt-5.4-2026-03-05"
    assert first_call["prompt_cache_retention"] == "24h"
    assert first_call["reasoning"] == {"effort": "high", "summary": "auto"}


@pytest.mark.parametrize(
    ("model", "effort"),
    [
        (Llm.GPT_5_5_NONE, "none"),
        (Llm.GPT_5_5_LOW, "low"),
        (Llm.GPT_5_5_MEDIUM, "medium"),
        (Llm.GPT_5_5_HIGH, "high"),
        (Llm.GPT_5_5_XHIGH, "xhigh"),
    ],
)
@pytest.mark.asyncio
async def test_openai_provider_session_uses_gpt_5_5_reasoning_effort(
    model: Llm,
    effort: str,
) -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=model,
        prompt_messages=[{"role": "user", "content": "Build a dashboard."}],
        tools=_test_tools(),
    )

    await session.stream_turn(_noop_event_sink)

    first_call = client.responses.calls[0]

    assert first_call["model"] == "gpt-5.5"
    assert first_call["reasoning"] == {"effort": effort, "summary": "auto"}


@pytest.mark.asyncio
async def test_openai_provider_session_uses_original_image_detail_for_gpt_5_5() -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=Llm.GPT_5_5_HIGH,
        prompt_messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Build from this screenshot."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,abc",
                            "detail": "high",
                        },
                    },
                ],
            }
        ],
        tools=_test_tools(),
    )

    await session.stream_turn(_noop_event_sink)

    first_input = client.responses.calls[0]["input"]
    image_part = first_input[0]["content"][1]

    assert image_part["type"] == "input_image"
    assert image_part["detail"] == "original"


@pytest.mark.asyncio
async def test_openai_provider_session_keeps_high_image_detail_for_non_gpt_5_5() -> None:
    client = _FakeOpenAIClient()
    session = OpenAIProviderSession(
        client=client,  # type: ignore[arg-type]
        model=Llm.GPT_5_4_MINI_LOW,
        prompt_messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Build from this screenshot."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,abc",
                            "detail": "low",
                        },
                    },
                ],
            }
        ],
        tools=_test_tools(),
    )

    await session.stream_turn(_noop_event_sink)

    first_input = client.responses.calls[0]["input"]
    image_part = first_input[0]["content"][1]

    assert image_part["type"] == "input_image"
    assert image_part["detail"] == "high"
