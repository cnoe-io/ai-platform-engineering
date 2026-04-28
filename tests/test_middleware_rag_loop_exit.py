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
        _rag_synthesis_turn_given,
        FetchDocumentCapWrapper,
        SearchCapWrapper,
    )
    _rag_capped_tools.clear()
    _rag_cap_hit_counts.clear()
    _rag_synthesis_turn_given.clear()
    FetchDocumentCapWrapper._global_counts.clear()
    FetchDocumentCapWrapper._global_timestamps.clear()
    SearchCapWrapper._global_counts.clear()
    SearchCapWrapper._global_timestamps.clear()
    yield
    _rag_capped_tools.clear()
    _rag_cap_hit_counts.clear()
    _rag_synthesis_turn_given.clear()
    FetchDocumentCapWrapper._global_counts.clear()
    FetchDocumentCapWrapper._global_timestamps.clear()
    SearchCapWrapper._global_counts.clear()
    SearchCapWrapper._global_timestamps.clear()


def _patch_config(thread_id: str = "test-thread"):
    return patch(
        "ai_platform_engineering.utils.deepagents_custom.middleware.get_config",
        return_value={"configurable": {"thread_id": thread_id}},
        create=True,
    )


class TestMiddlewareRagLoopExit:

    def test_terminates_when_all_rag_calls_capped(self):
        """When both wrapper counters are at max, after_model injects synthesis ToolMessages
        and calls _rag_terminal_response (which omits jump_to in USE_STRUCTURED_RESPONSE mode)."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            SearchCapWrapper,
            FetchDocumentCapWrapper,
            _DEFAULT_MAX_SEARCH_CALLS,
            _DEFAULT_MAX_FETCH_DOCUMENT_CALLS,
        )
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        SearchCapWrapper._global_counts["t1"] = _DEFAULT_MAX_SEARCH_CALLS
        FetchDocumentCapWrapper._global_counts["t1"] = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

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
        ), patch(
            "ai_platform_engineering.utils.deepagents_custom.middleware._rag_terminal_response",
            wraps=lambda msgs, tid="": {"messages": msgs},
        ) as mock_terminal:
            result = middleware.after_model(state)

        assert result is not None, "Expected middleware to inject synthesis messages"
        mock_terminal.assert_called_once(), "Must call _rag_terminal_response when budget exhausted"
        assert len(result["messages"]) == 2
        assert all(isinstance(m, ToolMessage) for m in result["messages"])
        # Both caps exhausted — message should tell LLM to synthesize, not mention remaining calls
        assert "synthesize" in result["messages"][0].content.lower()

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
        """When only search is capped and model calls ONLY search via the fallback path,
        middleware calls _rag_terminal_response to terminate."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _rag_capped_tools
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        # Populate _rag_capped_tools directly so is_rag_hard_stopped returns True.
        # Simulates _arun having capped the tool (fallback path, not batch path).
        _rag_capped_tools["t5"] = {"search"}

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
        ), patch(
            "ai_platform_engineering.utils.deepagents_custom.middleware._rag_terminal_response",
            wraps=lambda msgs, tid="": {"messages": msgs},
        ) as mock_terminal:
            result = middleware.after_model(state)

        assert result is not None
        mock_terminal.assert_called_once(), "Must call _rag_terminal_response"
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

    def test_mixed_batch_only_blocks_capped_tool(self):
        """When fetch is capped but search is not, a mixed batch should block only
        the fetch calls and the message should mention remaining search budget."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            FetchDocumentCapWrapper,
            _DEFAULT_MAX_FETCH_DOCUMENT_CALLS,
        )
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware
        from langchain_core.messages import ToolMessage

        FetchDocumentCapWrapper._global_counts["t9"] = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s1"),
            _tool_call("fetch_document", "tc-f1"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t9"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t9"}},
        ):
            result = middleware.after_model(state)

        # Only fetch_document should be blocked; search passes through (no ToolMessage for it)
        assert result is not None, "Expected middleware to block the capped fetch_document call"
        assert len(result["messages"]) == 1
        blocked = result["messages"][0]
        assert isinstance(blocked, ToolMessage)
        assert blocked.tool_call_id == "tc-f1"
        assert blocked.name == "fetch_document"
        # Message should tell LLM it has search calls remaining
        assert "search" in blocked.content.lower() and "remaining" in blocked.content.lower()

    def test_terminal_response_omits_jump_to_in_structured_mode(self):
        """_rag_terminal_response must NOT include jump_to=end when USE_STRUCTURED_RESPONSE=True
        so the LLM still gets a turn to call PlatformEngineerResponse."""
        from ai_platform_engineering.utils.deepagents_custom.middleware import _rag_terminal_response

        msgs = [ToolMessage(content="RAG call limit reached.", tool_call_id="tc-1", name="search")]

        # First confirm False produces jump_to=end (validates the patch mechanism works)
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.USE_STRUCTURED_RESPONSE",
            False,
        ):
            baseline = _rag_terminal_response(msgs)
        assert baseline.get("jump_to") == "end", "Baseline (False) must produce jump_to=end"

        # Now confirm True omits jump_to=end
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.USE_STRUCTURED_RESPONSE",
            True,
        ):
            result = _rag_terminal_response(msgs)
        assert "jump_to" not in result, "Must omit jump_to=end in structured mode"
        assert result["messages"] == msgs

    def test_terminal_response_includes_jump_to_in_plain_text_mode(self):
        """_rag_terminal_response must include jump_to=end when USE_STRUCTURED_RESPONSE=False."""
        from ai_platform_engineering.utils.deepagents_custom.middleware import _rag_terminal_response

        msgs = [ToolMessage(content="RAG call limit reached.", tool_call_id="tc-1", name="search")]

        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.USE_STRUCTURED_RESPONSE",
            False,
            create=True,
        ):
            result = _rag_terminal_response(msgs)
        assert result.get("jump_to") == "end"
        assert result["messages"] == msgs

    def test_rag_conversation_id_takes_priority_over_get_config(self):
        """When _rag_conversation_id ContextVar is set, after_model must use it rather than
        the thread_id from get_config — this is the mechanism that shares caps across child graphs."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            SearchCapWrapper,
            FetchDocumentCapWrapper,
            _DEFAULT_MAX_SEARCH_CALLS,
            _DEFAULT_MAX_FETCH_DOCUMENT_CALLS,
            set_rag_conversation_id,
            _rag_conversation_id,
        )
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        # Both budgets exhausted on "conv-123", clean on "thread-999"
        SearchCapWrapper._global_counts["conv-123"] = _DEFAULT_MAX_SEARCH_CALLS
        FetchDocumentCapWrapper._global_counts["conv-123"] = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s"),
            _tool_call("fetch_document", "tc-f"),
        ])
        state = _make_state([ai_msg])

        token = set_rag_conversation_id("conv-123")
        try:
            middleware = DeterministicTaskMiddleware()
            with patch(
                "langgraph.config.get_config",
                return_value={"configurable": {"thread_id": "thread-999"}},
            ), patch(
                "ai_platform_engineering.utils.deepagents_custom.middleware._rag_terminal_response",
                wraps=lambda msgs, tid="": {"messages": msgs},
            ) as mock_terminal:
                result = middleware.after_model(state)
        finally:
            _rag_conversation_id.reset(token)

        # Should have fired — cap was on "conv-123" which the ContextVar resolves
        assert result is not None, "Must use ContextVar thread_id (conv-123, capped), not get_config thread_id (thread-999, clean)"
        mock_terminal.assert_called_once()

    def test_over_budget_batch_blocks_all_and_reports_remaining(self):
        """When cap=5 and 3 calls already used, a batch of 5 should block ALL 5,
        tell the LLM it has 2 remaining, and NOT increment cap_hit_count
        (budget still exists — this is a batch-size correction, not a true cap hit)."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            SearchCapWrapper,
            _DEFAULT_MAX_SEARCH_CALLS,
            _rag_cap_hit_counts,
        )
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware
        from langchain_core.messages import ToolMessage

        # 3 of 5 slots already used → 2 remaining
        SearchCapWrapper._global_counts["t10"] = _DEFAULT_MAX_SEARCH_CALLS - 2

        ai_msg = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-s1"),
            _tool_call("search", "tc-s2"),
            _tool_call("search", "tc-s3"),
            _tool_call("search", "tc-s4"),
            _tool_call("search", "tc-s5"),
        ])
        state = _make_state([ai_msg])

        middleware = DeterministicTaskMiddleware()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": "t10"}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": "t10"}},
        ):
            result = middleware.after_model(state)

        # All 5 blocked (LLM asked for too many — let it re-strategize)
        assert result is not None
        assert len(result["messages"]) == 5
        assert all(isinstance(m, ToolMessage) for m in result["messages"])
        # Message must tell LLM it has exactly 2 search calls remaining
        content = result["messages"][0].content
        assert "2 search call" in content.lower() and "remaining" in content.lower()
        # Budget still exists — must NOT have incremented cap_hit_count
        assert _rag_cap_hit_counts.get("t10", 0) == 0, "cap_hit_count must stay 0 when budget remains"
        # No jump_to=end when budget remains
        assert "jump_to" not in result

    def test_multi_turn_loop_terminates_after_cap_exhaustion(self):
        """Multi-turn loop: turns 1-5 succeed, turn 6 hits cap (blocked with remaining=0),
        turn 7 model ignores the cap message and calls search again — after_model must still
        terminate via the fallback path (_rag_hard_stopped)."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            SearchCapWrapper,
            FetchDocumentCapWrapper,
            _DEFAULT_MAX_SEARCH_CALLS,
            _DEFAULT_MAX_FETCH_DOCUMENT_CALLS,
            _rag_capped_tools,
        )
        from ai_platform_engineering.utils.deepagents_custom.middleware import DeterministicTaskMiddleware

        thread_id = "t-loop"

        # Simulate turns 1-5: search budget fully consumed, fetch also fully consumed
        SearchCapWrapper._global_counts[thread_id] = _DEFAULT_MAX_SEARCH_CALLS
        FetchDocumentCapWrapper._global_counts[thread_id] = _DEFAULT_MAX_FETCH_DOCUMENT_CALLS

        middleware = DeterministicTaskMiddleware()

        # Turn 6: batch cap fires — both tools exhausted, terminal response returned
        ai_msg_turn6 = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-t6-s"),
            _tool_call("fetch_document", "tc-t6-f"),
        ])
        state_turn6 = _make_state([ai_msg_turn6])

        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": thread_id}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": thread_id}},
        ), patch(
            "ai_platform_engineering.utils.deepagents_custom.middleware._rag_terminal_response",
            wraps=lambda msgs, tid="": {"messages": msgs},
        ) as mock_terminal_t6:
            result_t6 = middleware.after_model(state_turn6)

        assert result_t6 is not None, "Turn 6: must terminate — both caps exhausted"
        mock_terminal_t6.assert_called_once()
        # Both tools should now be recorded in _rag_capped_tools
        assert "search" in _rag_capped_tools.get(thread_id, set())
        assert "fetch_document" in _rag_capped_tools.get(thread_id, set())

        # Turn 7: model ignores the cap message and calls search again.
        # Fallback path (is_rag_hard_stopped) must fire.
        ai_msg_turn7 = _make_ai_message_with_tool_calls([
            _tool_call("search", "tc-t7-s"),
        ])
        state_turn7 = _make_state([ai_msg_turn7])

        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {"thread_id": thread_id}},
        ), patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"thread_id": thread_id}},
        ), patch(
            "ai_platform_engineering.utils.deepagents_custom.middleware._rag_terminal_response",
            wraps=lambda msgs, tid="": {"messages": msgs},
        ) as mock_terminal_t7:
            result_t7 = middleware.after_model(state_turn7)

        assert result_t7 is not None, "Turn 7: must terminate via fallback — search still capped"
        mock_terminal_t7.assert_called_once(), "Fallback path must call _rag_terminal_response"

    def test_structured_response_second_turn_forces_jump_to_end(self):
        """In USE_STRUCTURED_RESPONSE mode, _rag_terminal_response grants one free synthesis
        turn (no jump_to=end). If the model ignores it and hits the cap again, the second
        call must force jump_to=end to prevent an infinite loop."""
        from ai_platform_engineering.utils.deepagents_custom.middleware import _rag_terminal_response
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _rag_synthesis_turn_given,
        )

        msgs = [ToolMessage(content="RAG cap reached.", tool_call_id="tc-1", name="search")]
        thread_id = "t-sr-loop"

        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.USE_STRUCTURED_RESPONSE",
            True,
        ):
            # First call: synthesis turn granted, no jump_to
            result1 = _rag_terminal_response(msgs, thread_id)
            assert "jump_to" not in result1, "First call must not include jump_to=end"
            assert thread_id in _rag_synthesis_turn_given, "Must record synthesis turn given"

            # Second call: model ignored synthesis nudge — force exit
            result2 = _rag_terminal_response(msgs, thread_id)
            assert result2.get("jump_to") == "end", "Second call must force jump_to=end"
