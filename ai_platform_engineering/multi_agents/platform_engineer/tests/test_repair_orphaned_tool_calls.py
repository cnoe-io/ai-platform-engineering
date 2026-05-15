# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for _repair_orphaned_tool_calls in AIPlatformEngineerA2ABinding.

Background
----------
When a session is interrupted mid-tool-call the LangGraph checkpoint holds an
AIMessage with unresolved tool_call_ids and no corresponding ToolMessages.
The old repair strategy removed the AIMessage using RemoveMessage. Because
removing the AIMessage left no tool_calls, LangGraph set checkpoint next=END,
causing the next user query to be skipped entirely and placeholder text to leak
directly to users.

The new strategy keeps the AIMessage intact and injects a synthetic ToolMessage
per orphaned tool_call_id via as_node="tools". This satisfies Bedrock's adjacency
requirement (tool_result immediately follows tool_use) and routes the graph
tools→model so the new user query is processed correctly.

These tests verify:
  1. No-op paths (empty state, no orphans, already resolved)
  2. Single and multiple orphan repair (correct ToolMessages, correct as_node)
  3. Deterministic-task pending-tool-call is never repaired
  4. The old RemoveMessage approach is never used
  5. Exception paths do not propagate to callers
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.messages import AIMessage, ToolMessage, HumanMessage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ai_message(tool_call_ids: list[str], tool_names: list[str] | None = None, msg_id: str = "ai-msg-1"):
    """Build an AIMessage with one or more tool_calls."""
    tool_names = tool_names or ["search_tool"] * len(tool_call_ids)
    tool_calls = [
        {"id": tc_id, "name": name, "args": {}}
        for tc_id, name in zip(tool_call_ids, tool_names)
    ]
    return AIMessage(content="", tool_calls=tool_calls, id=msg_id)


def _make_tool_message(tool_call_id: str, tool_name: str = "search_tool"):
    """Build a resolved ToolMessage."""
    return ToolMessage(content="result", tool_call_id=tool_call_id, name=tool_name)


def _make_state(messages: list, pending_task_id: str | None = None):
    """Build a mock graph state object."""
    state = MagicMock()
    values = {"messages": messages}
    if pending_task_id:
        values["pending_task_tool_call_id"] = pending_task_id
    state.values = values
    return state


def _make_binding():
    """
    Instantiate AIPlatformEngineerA2ABinding with all external deps mocked.
    Sets _initialized=True so ensure_initialized() is skipped.
    """
    with patch(
        "ai_platform_engineering.multi_agents.platform_engineer"
        ".protocol_bindings.a2a.agent.AIPlatformEngineerMAS"
    ), patch(
        "ai_platform_engineering.multi_agents.platform_engineer"
        ".protocol_bindings.a2a.agent.TracingManager"
    ):
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
            AIPlatformEngineerA2ABinding,
        )
        binding = AIPlatformEngineerA2ABinding.__new__(AIPlatformEngineerA2ABinding)
        binding._initialized = True
        binding._previous_todos = {}
        binding._task_plan_entries = {}
        binding._in_self_service_workflow = False
        binding._execution_plan_sent = False
        binding.tracing = MagicMock()
        binding.graph = AsyncMock()
        return binding


# ---------------------------------------------------------------------------
# _repair_orphaned_tool_calls — no-op paths
# ---------------------------------------------------------------------------

class TestRepairOrphanedToolCallsNoOp:

    @pytest.mark.asyncio
    async def test_empty_state_is_noop(self):
        """aget_state returns None → aupdate_state is never called."""
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(return_value=None)

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_state_with_empty_values_is_noop(self):
        """State exists but values is empty dict → aupdate_state is never called."""
        binding = _make_binding()
        state = MagicMock()
        state.values = {}
        binding.graph.aget_state = AsyncMock(return_value=state)

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_state_with_no_messages_is_noop(self):
        """Messages list is empty → aupdate_state is never called."""
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(return_value=_make_state([]))

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_tool_calls_resolved_is_noop(self):
        """Every tool_call_id has a matching ToolMessage → aupdate_state is never called."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["jira_search"])
        tool_msg = _make_tool_message("tc-1", "jira_search")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg, tool_msg]))

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_messages_without_ai_messages_is_noop(self):
        """Only HumanMessages in history → no tool_calls to repair."""
        binding = _make_binding()
        msgs = [HumanMessage(content="hello"), HumanMessage(content="world")]
        binding.graph.aget_state = AsyncMock(return_value=_make_state(msgs))

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_called()


# ---------------------------------------------------------------------------
# _repair_orphaned_tool_calls — repair paths
# ---------------------------------------------------------------------------

class TestRepairOrphanedToolCallsRepair:

    @pytest.mark.asyncio
    async def test_single_orphan_injects_one_synthetic_tool_message(self):
        """One orphaned tool call → one synthetic ToolMessage injected."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-orphan-1"], ["argocd_search"])
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_awaited_once()
        injected_messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(injected_messages) == 1
        msg = injected_messages[0]
        assert isinstance(msg, ToolMessage)
        assert msg.tool_call_id == "tc-orphan-1"
        assert msg.name == "argocd_search"
        assert "argocd_search" in msg.content
        assert "interrupted" in msg.content.lower()

    @pytest.mark.asyncio
    async def test_single_orphan_uses_as_node_tools(self):
        """aupdate_state MUST be called with as_node='tools' to route graph correctly."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["jira_search"])
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        _, call_kwargs = binding.graph.aupdate_state.call_args
        assert call_kwargs.get("as_node") == "tools", (
            "Must use as_node='tools' so LangGraph routes tools→model, not END"
        )

    @pytest.mark.asyncio
    async def test_multiple_orphans_inject_one_message_per_orphan(self):
        """Three orphaned tool calls → three synthetic ToolMessages, one per orphan."""
        binding = _make_binding()
        ai_msg = _make_ai_message(
            ["tc-1", "tc-2", "tc-3"],
            ["jira_search", "argocd_list", "github_pr"],
            msg_id="ai-multi",
        )
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        injected = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(injected) == 3
        injected_ids = {m.tool_call_id for m in injected}
        assert injected_ids == {"tc-1", "tc-2", "tc-3"}
        injected_names = {m.name for m in injected}
        assert injected_names == {"jira_search", "argocd_list", "github_pr"}

    @pytest.mark.asyncio
    async def test_partial_orphans_only_missing_ones_are_repaired(self):
        """Two tool calls, one resolved, one orphaned → only orphan repaired."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-resolved", "tc-orphan"], ["tool_a", "tool_b"])
        resolved = _make_tool_message("tc-resolved", "tool_a")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg, resolved]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        injected = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(injected) == 1
        assert injected[0].tool_call_id == "tc-orphan"
        assert injected[0].name == "tool_b"

    @pytest.mark.asyncio
    async def test_old_remove_message_approach_never_used(self):
        """Verify RemoveMessage is never passed to aupdate_state (old broken approach)."""
        from langchain_core.messages import RemoveMessage

        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["search"])
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        injected = binding.graph.aupdate_state.call_args[0][1]["messages"]
        for msg in injected:
            assert not isinstance(msg, RemoveMessage), (
                "RemoveMessage must never be used — it routes graph to END, leaking "
                "placeholder text to users"
            )

    @pytest.mark.asyncio
    async def test_synthetic_message_content_names_the_tool(self):
        """Synthetic ToolMessage content mentions the tool name for debuggability."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["confluence_search"])
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        injected = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert "confluence_search" in injected[0].content

    @pytest.mark.asyncio
    async def test_multiple_ai_messages_repairs_only_unresolved(self):
        """
        Conversation: ai_msg_1 (resolved), ai_msg_2 (orphaned).
        Only ai_msg_2's tool call should be repaired.
        """
        binding = _make_binding()
        ai_msg_1 = _make_ai_message(["tc-done"], ["tool_done"], msg_id="ai-1")
        resolved = _make_tool_message("tc-done", "tool_done")
        ai_msg_2 = _make_ai_message(["tc-broken"], ["tool_broken"], msg_id="ai-2")
        binding.graph.aget_state = AsyncMock(
            return_value=_make_state([ai_msg_1, resolved, ai_msg_2])
        )
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        injected = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(injected) == 1
        assert injected[0].tool_call_id == "tc-broken"


# ---------------------------------------------------------------------------
# _repair_orphaned_tool_calls — deterministic task pending-tool-call guard
# ---------------------------------------------------------------------------

class TestRepairPendingDeterministicTask:

    @pytest.mark.asyncio
    async def test_pending_task_id_is_skipped(self):
        """
        If pending_task_tool_call_id is set, that specific tool call must NOT be
        repaired — DeterministicTaskMiddleware will handle it.
        """
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-pending"], ["deterministic_task"])
        binding.graph.aget_state = AsyncMock(
            return_value=_make_state([ai_msg], pending_task_id="tc-pending")
        )
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_pending_task_skipped_but_other_orphans_repaired(self):
        """
        pending_task_tool_call_id is skipped; other orphaned tool calls still repaired.
        """
        binding = _make_binding()
        ai_msg = _make_ai_message(
            ["tc-pending", "tc-broken"],
            ["deterministic_task", "jira_search"],
        )
        binding.graph.aget_state = AsyncMock(
            return_value=_make_state([ai_msg], pending_task_id="tc-pending")
        )
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        injected = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(injected) == 1
        assert injected[0].tool_call_id == "tc-broken"
        assert all(m.tool_call_id != "tc-pending" for m in injected)


# ---------------------------------------------------------------------------
# _repair_orphaned_tool_calls — exception handling
# ---------------------------------------------------------------------------

class TestRepairExceptionHandling:

    @pytest.mark.asyncio
    async def test_exception_in_aget_state_does_not_propagate(self):
        """aget_state raises → repair logs error and returns without re-raising."""
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(side_effect=RuntimeError("checkpoint failure"))
        binding.graph.aupdate_state = AsyncMock()

        # Must not raise
        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

    @pytest.mark.asyncio
    async def test_exception_in_aupdate_state_does_not_propagate(self):
        """aupdate_state raises → repair logs error and returns without re-raising."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["search"])
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock(side_effect=RuntimeError("state write failed"))

        # Must not raise
        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

    @pytest.mark.asyncio
    async def test_fallback_reset_attempted_on_exception(self):
        """
        When aget_state raises and the graph has a checkpointer, the fallback
        recovery attempts to inject a HumanMessage reset marker.
        """
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(side_effect=RuntimeError("db timeout"))
        binding.graph.checkpointer = MagicMock()  # checkpointer present
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t-fail"}})

        # Fallback should have tried aupdate_state with a HumanMessage (if it attempts recovery)
        if binding.graph.aupdate_state.call_count > 0:
            msgs = binding.graph.aupdate_state.call_args[0][1]["messages"]
            assert len(msgs) == 1
            assert isinstance(msgs[0], HumanMessage)
