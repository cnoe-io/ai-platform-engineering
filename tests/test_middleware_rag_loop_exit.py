#!/usr/bin/env python3
"""
Gap 1: Tests for DeterministicTaskMiddleware RAG loop exit logic.

Verifies that after_model() terminates the graph when all RAG tool calls
target individually-capped tools, and does NOT terminate when uncapped
tools are still available.

This was the exact code path that caused the "no output in Slack" regression
when the middleware terminated the graph too aggressively.

Usage:
    pytest tests/test_middleware_rag_loop_exit.py -v
"""

from unittest.mock import patch
import pytest
from langchain_core.messages import AIMessage, ToolMessage


def _make_ai_message_with_tool_calls(tool_calls: list[dict]) -> AIMessage:
    """Build an AIMessage with tool_calls metadata."""
    return AIMessage(content="", tool_calls=tool_calls)


def _tool_call(name: str, call_id: str = "tc-1", args: dict | None = None) -> dict:
    return {"name": name, "id": call_id, "args": args or {}}


def _make_state(messages: list) -> dict:
    return {"messages": messages, "todos": []}


@pytest.fixture(autouse=True)
def _reset_rag_state():
    """Ensure RAG cap state is clean before each test."""
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
        _rag_capped_tools,
        _rag_cap_hit_counts,
    )
    _rag_capped_tools.clear()
    _rag_cap_hit_counts.clear()
    yield
    _rag_capped_tools.clear()
    _rag_cap_hit_counts.clear()


def _patch_config(thread_id: str = "test-thread"):
    return patch(
        "ai_platform_engineering.utils.deepagents_custom.middleware.get_config",
        return_value={"configurable": {"thread_id": thread_id}},
        create=True,
    )


class TestMiddlewareRagLoopExit:

    def test_terminates_when_all_rag_calls_capped(self):
        """When both search and fetch_document are capped and the model still calls them,
        after_model should inject synthesis ToolMessages WITHOUT jump_to='end' so the LLM
        gets one turn to produce a real answer. See PR #1231 (SDPL-1601)."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _record_rag_cap_hit
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        _record_rag_cap_hit("t1", "search")
        _record_rag_cap_hit("t1", "fetch_document")

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s"),
            _tool_call("fetch_document", "tc-f"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t1"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t1"}},
        ):
            result = middleware.after_model(state)

        assert result is not None, "Expected middleware to inject synthesis messages"
        assert "jump_to" not in result, "Must NOT jump_to end — LLM needs a turn to synthesize"
        assert len(result["messages"]) == 2
        assert all(isinstance(m, ToolMessage) for m in result["messages"])

    def test_does_not_terminate_when_only_search_capped(self):
        """When only search is capped but model calls fetch_document too,
        middleware should NOT terminate — fetch_document still has budget."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _record_rag_cap_hit
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        _record_rag_cap_hit("t2", "search")

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s"),
            _tool_call("fetch_document", "tc-f"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t2"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t2"}},
        ):
            result = middleware.after_model(state)

        assert result is None, "Should not terminate — fetch_document is not capped"

    def test_does_not_terminate_when_no_caps_hit(self):
        """When no RAG caps are hit, middleware should not interfere."""
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t3"}},
        ):
            result = middleware.after_model(state)

        assert result is None

    def test_does_not_terminate_for_mixed_rag_and_non_rag_calls(self):
        """When some calls are non-RAG tools, middleware should not terminate
        even if RAG tools are capped."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _record_rag_cap_hit
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        _record_rag_cap_hit("t4", "search")

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s"),
            _tool_call("write_todos", "tc-w", {"todos": [{"id": "1", "content": "x", "status": "pending"}]}),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t4"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t4"}},
        ):
            result = middleware.after_model(state)

        assert result is None, "Mixed RAG + non-RAG calls should not trigger termination"

    def test_terminates_with_only_search_capped_and_only_search_called(self):
        """When only search is capped and model calls ONLY search,
        middleware should inject synthesis messages WITHOUT jump_to='end'."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _record_rag_cap_hit
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        _record_rag_cap_hit("t5", "search")

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s1"),
            _tool_call("search", "tc-s2"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t5"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t5"}},
        ):
            result = middleware.after_model(state)

        assert result is not None
        assert "jump_to" not in result, "Must NOT jump_to end — LLM needs a turn to synthesize"
        assert len(result["messages"]) == 2

    def test_tool_messages_have_correct_ids(self):
        """Injected ToolMessages must reference the correct tool_call_ids."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _record_rag_cap_hit
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        _record_rag_cap_hit("t6", "search")
        _record_rag_cap_hit("t6", "fetch_document")

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "call-abc"),
            _tool_call("fetch_document", "call-def"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t6"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t6"}},
        ):
            result = middleware.after_model(state)

        tool_call_ids = {m.tool_call_id for m in result["messages"]}
        assert tool_call_ids == {"call-abc", "call-def"}

    def test_no_messages_returns_none(self):
        """Empty state should return None."""
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        middleware = DeterministicTaskMiddleware()
        assert middleware.after_model({"messages": []}) is None
        assert middleware.after_model({}) is None

    def test_non_tool_ai_message_returns_none(self):
        """AIMessage without tool calls should return None."""
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        state = _make_state([AIMessage(content="Just a text response")])
        middleware = DeterministicTaskMiddleware()
        assert middleware.after_model(state) is None
