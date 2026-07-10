from langchain.agents.middleware.context_editing import ContextEditingMiddleware
from langchain.agents.middleware.model_retry import ModelRetryMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from dynamic_agents.services.middleware import (
    InterruptAwareToolRetryMiddleware,
    ToolResultInvariantMiddleware,
    build_middleware,
    get_default_middleware_entries,
    get_middleware_definitions,
)


def test_default_middleware_entries_enable_context_editing_and_raise_model_errors():
    entries = {entry["type"]: entry for entry in get_default_middleware_entries()}

    assert entries["model_retry"]["params"]["on_failure"] == "error"
    assert entries["tool_retry"]["params"]["on_failure"] == "continue"
    assert entries["context_editing"]["enabled"] is True
    assert entries["context_editing"]["params"] == {"trigger": 100_000, "keep": 3}


def test_middleware_definitions_mark_context_editing_enabled_by_default():
    definitions = {definition["key"]: definition for definition in get_middleware_definitions()}

    assert definitions["model_retry"]["default_params"]["on_failure"] == "error"
    assert definitions["context_editing"]["enabled_by_default"] is True


def test_build_middleware_uses_context_editing_guardrail_by_default():
    stack = build_middleware(None, agent_name="test-agent", model_id="test-model")

    model_retry = next(middleware for middleware in stack if isinstance(middleware, ModelRetryMiddleware))
    tool_retry = next(
        middleware for middleware in stack if isinstance(middleware, InterruptAwareToolRetryMiddleware)
    )
    context_editing = next(middleware for middleware in stack if isinstance(middleware, ContextEditingMiddleware))

    assert model_retry.on_failure == "error"
    assert tool_retry.max_retries == 3
    assert context_editing.edits[0].trigger == 100_000
    assert context_editing.edits[0].keep == 3
    assert any(isinstance(middleware, ToolResultInvariantMiddleware) for middleware in stack)


def test_tool_result_invariant_patches_missing_parallel_result():
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


def test_tool_result_invariant_preserves_complete_history():
    messages = [
        AIMessage(
            content="",
            tool_calls=[{"name": "read_file", "args": {}, "id": "call-a"}],
        ),
        ToolMessage(content="done", tool_call_id="call-a", name="read_file"),
    ]

    assert ToolResultInvariantMiddleware._patch_messages(messages) == messages


def test_tool_result_invariant_moves_result_next_to_tool_call():
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


def test_tool_result_invariant_patches_content_block_tool_call():
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


def test_tool_result_invariant_patches_invalid_tool_call():
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
