"""Regression coverage for dangling Bedrock tool-use messages."""

from typing import Any

from langchain.agents import create_agent
from langchain_aws.chat_models.bedrock_converse import _messages_to_bedrock
from langchain_aws.data._profiles import _PROFILES
from langchain_core.callbacks.manager import CallbackManagerForLLMRun
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from pydantic import Field

from dynamic_agents.services.middleware import ToolResultInvariantMiddleware


class _CapturingFakeModel(FakeMessagesListChatModel):
    """Deterministic model that records the final middleware request."""

    captured_messages: list[list[BaseMessage]] = Field(default_factory=list)

    def bind_tools(
        self,
        tools: Any,
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> "_CapturingFakeModel":
        del tools, tool_choice, kwargs
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.captured_messages.append(list(messages))
        return super()._generate(messages, stop, run_manager, **kwargs)


def test_patches_missing_parallel_result() -> None:
    messages = [
        HumanMessage(content="Inspect both files"),
        AIMessage(
            content="",
            tool_calls=[
                {"name": "read_file", "args": {"path": "a"}, "id": "call-a"},
                {"name": "read_file", "args": {"path": "b"}, "id": "call-b"},
            ],
        ),
        ToolMessage(content="a contents", tool_call_id="call-a", name="read_file"),
    ]

    patched = ToolResultInvariantMiddleware._patch_messages(messages)

    results = [message for message in patched if isinstance(message, ToolMessage)]
    assert {message.tool_call_id for message in results} == {"call-a", "call-b"}
    missing_result = next(message for message in results if message.tool_call_id == "call-b")
    assert missing_result.status == "error"


def test_preserves_complete_history() -> None:
    messages = [
        AIMessage(
            content="",
            tool_calls=[{"name": "read_file", "args": {}, "id": "call-a"}],
        ),
        ToolMessage(content="done", tool_call_id="call-a", name="read_file"),
    ]

    assert ToolResultInvariantMiddleware._patch_messages(messages) == messages


def test_moves_result_next_to_tool_call() -> None:
    tool_call = AIMessage(
        content="",
        tool_calls=[{"name": "read_file", "args": {}, "id": "call-a"}],
    )
    tool_result = ToolMessage(content="done", tool_call_id="call-a", name="read_file")
    messages = [tool_call, HumanMessage(content="new request"), tool_result]

    assert ToolResultInvariantMiddleware._patch_messages(messages) == [
        tool_call,
        tool_result,
        messages[1],
    ]


def test_patches_content_block_tool_call() -> None:
    messages = [
        AIMessage(
            content=[
                {
                    "type": "tool_use",
                    "id": "call-a",
                    "name": "read_file",
                    "input": {"file_path": "history.md"},
                }
            ]
        )
    ]

    patched = ToolResultInvariantMiddleware._patch_messages(messages)

    assert isinstance(patched[1], ToolMessage)
    assert patched[1].tool_call_id == "call-a"


def test_patches_invalid_tool_call() -> None:
    messages = [
        AIMessage(
            content="",
            invalid_tool_calls=[
                {
                    "type": "invalid_tool_call",
                    "id": "call-a",
                    "name": "read_file",
                    "args": "{broken",
                    "error": "invalid JSON",
                }
            ],
        )
    ]

    patched = ToolResultInvariantMiddleware._patch_messages(messages)

    assert isinstance(patched[1], ToolMessage)
    assert patched[1].tool_call_id == "call-a"


async def test_async_agent_repairs_history_before_model_call() -> None:
    model = _CapturingFakeModel(responses=[AIMessage(content="Recovered response")])
    graph = create_agent(
        model,
        tools=[],
        middleware=[ToolResultInvariantMiddleware()],
    )

    result = await graph.ainvoke(
        {
            "messages": [
                HumanMessage(content="Start"),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "read_file", "args": {}, "id": "call-a"}],
                ),
                HumanMessage(content="Follow up"),
            ]
        }
    )

    assert result["messages"][-1].content == "Recovered response"
    captured = model.captured_messages[0]
    tool_result = next(message for message in captured if isinstance(message, ToolMessage))
    assert tool_result.tool_call_id == "call-a"
    assert captured.index(tool_result) == 2
    assert captured[3].content == "Follow up"


def test_repaired_history_serializes_to_valid_bedrock_tool_result() -> None:
    patched = ToolResultInvariantMiddleware._patch_messages(
        [
            AIMessage(
                content="",
                tool_calls=[{"name": "read_file", "args": {}, "id": "call-a"}],
            ),
            HumanMessage(content="Follow up"),
        ]
    )

    bedrock_messages, system = _messages_to_bedrock(patched)

    assert system == []
    assert bedrock_messages[0]["role"] == "assistant"
    assert bedrock_messages[0]["content"][0]["toolUse"]["toolUseId"] == "call-a"
    assert bedrock_messages[1]["role"] == "user"
    tool_result = bedrock_messages[1]["content"][0]["toolResult"]
    assert tool_result["toolUseId"] == "call-a"
    assert tool_result["status"] == "error"


def test_global_bedrock_profile_has_context_window_metadata() -> None:
    profile = _PROFILES["global.anthropic.claude-sonnet-4-5-20250929-v1:0"]

    assert profile["max_input_tokens"] == 200_000
