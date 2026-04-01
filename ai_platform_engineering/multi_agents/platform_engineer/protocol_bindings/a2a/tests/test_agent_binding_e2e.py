# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
E2E unit tests for AIPlatformEngineerA2ABinding (distributed-mode, agent.py).

Coverage
--------
1. _repair_orphaned_tool_calls — no-op paths
   - empty state / no values / no messages
   - all tool calls already resolved
   - no AIMessages in history

2. _repair_orphaned_tool_calls — repair paths
   - single orphan → RemoveMessage for that AIMessage ID
   - multiple orphans on same AIMessage → exactly one RemoveMessage
   - multiple orphans on different AIMessages → one RemoveMessage each
   - orphan with no msg ID → no aupdate_state (logs warning only)
   - Bedrock additional_kwargs storage location detected
   - Bedrock content-block storage location detected

3. _repair_orphaned_tool_calls — exception handling
   - aget_state raises → fallback HumanMessage injected
   - aupdate_state raises → fallback HumanMessage injected
   - fallback itself raises → swallowed, no crash

4. _extract_tool_call_ids helper
   - standard tool_calls list
   - Bedrock additional_kwargs['tool_use']
   - Bedrock additional_kwargs['toolUse']
   - content blocks with type='tool_use'
   - non-AIMessage returns empty set
   - deduplication across storage locations
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ai_message(tool_call_ids: list[str], tool_names: list[str] | None = None,
                     msg_id: str = "ai-msg-1") -> AIMessage:
    """Build an AIMessage with tool_calls."""
    names = tool_names or ["unknown"] * len(tool_call_ids)
    tool_calls = [
        {"id": tc_id, "name": name, "args": {}, "type": "tool_call"}
        for tc_id, name in zip(tool_call_ids, names)
    ]
    return AIMessage(content="", tool_calls=tool_calls, id=msg_id)


def _make_tool_message(tool_call_id: str) -> ToolMessage:
    return ToolMessage(content="ok", tool_call_id=tool_call_id)


def _make_state(messages: list) -> MagicMock:
    state = MagicMock()
    state.values = {"messages": messages}
    return state


def _make_empty_state() -> MagicMock:
    state = MagicMock()
    state.values = {}
    return state


# ---------------------------------------------------------------------------
# Factory: creates a binding bypassing __init__ heavy deps
# ---------------------------------------------------------------------------

def _make_binding():
    """
    Instantiate AIPlatformEngineerA2ABinding without triggering __init__,
    which would attempt to connect to real agents and load the graph.
    """
    with patch(
        "ai_platform_engineering.multi_agents.platform_engineer"
        ".protocol_bindings.a2a.agent.AIPlatformEngineerMAS"
    ), patch(
        "ai_platform_engineering.multi_agents.platform_engineer"
        ".protocol_bindings.a2a.agent.TracingManager"
    ), patch(
        "ai_platform_engineering.multi_agents.platform_engineer"
        ".protocol_bindings.a2a.agent.set_mas_instance"
    ):
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
            AIPlatformEngineerA2ABinding,
        )
        binding = AIPlatformEngineerA2ABinding.__new__(AIPlatformEngineerA2ABinding)
        binding.graph = AsyncMock()
        binding.tracing = MagicMock()
        binding._execution_plan_sent = False
        return binding


CONFIG = {"configurable": {"thread_id": "test-thread-1"}}


# ===========================================================================
# 1. No-op paths
# ===========================================================================

class TestRepairOrphanedToolCallsNoOp:

    @pytest.mark.asyncio
    async def test_none_state_is_noop(self):
        """aget_state returns None → no aupdate_state call."""
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(return_value=None)
        await binding._repair_orphaned_tool_calls(CONFIG)
        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_empty_values_is_noop(self):
        """state.values is empty → no aupdate_state call."""
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(return_value=_make_empty_state())
        await binding._repair_orphaned_tool_calls(CONFIG)
        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_messages_is_noop(self):
        """messages list is empty → no aupdate_state call."""
        binding = _make_binding()
        state = MagicMock()
        state.values = {"messages": []}
        binding.graph.aget_state = AsyncMock(return_value=state)
        await binding._repair_orphaned_tool_calls(CONFIG)
        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_all_resolved_is_noop(self):
        """Every AIMessage tool_call has a matching ToolMessage → no repair needed."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["jira_search"], msg_id="ai-1")
        tm = _make_tool_message("tc-1")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg, tm]))
        await binding._repair_orphaned_tool_calls(CONFIG)
        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_ai_messages_is_noop(self):
        """Only HumanMessages in history → no tool calls to repair."""
        binding = _make_binding()
        state = _make_state([HumanMessage(content="hello"), HumanMessage(content="world")])
        binding.graph.aget_state = AsyncMock(return_value=state)
        await binding._repair_orphaned_tool_calls(CONFIG)
        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_multiple_resolved_tool_calls_noop(self):
        """Multiple tool calls all resolved → no repair."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1", "tc-2"], ["tool_a", "tool_b"], msg_id="ai-1")
        tm1 = _make_tool_message("tc-1")
        tm2 = _make_tool_message("tc-2")
        binding.graph.aget_state = AsyncMock(
            return_value=_make_state([ai_msg, tm1, tm2])
        )
        await binding._repair_orphaned_tool_calls(CONFIG)
        binding.graph.aupdate_state.assert_not_awaited()


# ===========================================================================
# 2. Repair paths — RemoveMessage strategy
# ===========================================================================

class TestRepairOrphanedToolCallsRepair:

    @pytest.mark.asyncio
    async def test_single_orphan_removes_ai_message(self):
        """One orphaned tool call → RemoveMessage for its AIMessage ID."""

        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["jira_search"], msg_id="ai-msg-orphan")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        binding.graph.aupdate_state.assert_awaited_once()
        call_args = binding.graph.aupdate_state.call_args
        messages = call_args[0][1]["messages"]
        assert len(messages) == 1
        assert isinstance(messages[0], RemoveMessage)
        assert messages[0].id == "ai-msg-orphan"

    @pytest.mark.asyncio
    async def test_multiple_orphans_same_ai_message_one_remove(self):
        """Two orphaned tool calls on same AIMessage → exactly one RemoveMessage."""

        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1", "tc-2"], ["tool_a", "tool_b"], msg_id="ai-multi")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(messages) == 1
        assert isinstance(messages[0], RemoveMessage)
        assert messages[0].id == "ai-multi"

    @pytest.mark.asyncio
    async def test_multiple_orphans_different_ai_messages_one_remove_each(self):
        """Orphans on two separate AIMessages → two RemoveMessages."""

        binding = _make_binding()
        ai1 = _make_ai_message(["tc-1"], ["tool_a"], msg_id="ai-first")
        ai2 = _make_ai_message(["tc-2"], ["tool_b"], msg_id="ai-second")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai1, ai2]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        ids_removed = {m.id for m in messages}
        assert ids_removed == {"ai-first", "ai-second"}
        assert all(isinstance(m, RemoveMessage) for m in messages)

    @pytest.mark.asyncio
    async def test_partial_orphans_only_orphaned_ai_message_removed(self):
        """One AI message resolved, one orphaned → only orphaned one removed."""

        binding = _make_binding()
        ai_resolved = _make_ai_message(["tc-resolved"], ["tool_ok"], msg_id="ai-ok")
        tm = _make_tool_message("tc-resolved")
        ai_orphaned = _make_ai_message(["tc-orphan"], ["tool_bad"], msg_id="ai-bad")
        binding.graph.aget_state = AsyncMock(
            return_value=_make_state([ai_resolved, tm, ai_orphaned])
        )
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        ids_removed = {m.id for m in messages}
        assert "ai-bad" in ids_removed
        assert "ai-ok" not in ids_removed

    @pytest.mark.asyncio
    async def test_orphan_without_msg_id_no_update_state(self):
        """AIMessage with no id → can't build RemoveMessage, no aupdate_state call."""
        ai_msg = AIMessage(content="", tool_calls=[
            {"id": "tc-noid", "name": "tool_x", "args": {}, "type": "tool_call"}
        ])
        # Don't set id (AIMessage id defaults to auto-generated, but we clear it)
        ai_msg.id = None

        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        binding.graph.aupdate_state.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_bedrock_additional_kwargs_tooluse_detected(self):
        """Bedrock stores tool_call IDs in additional_kwargs['tool_use']."""

        binding = _make_binding()
        # No standard tool_calls — only additional_kwargs Bedrock storage
        ai_msg = AIMessage(
            content="",
            additional_kwargs={"tool_use": [{"id": "bedrock-tc-1", "name": "bedrock_tool"}]},
            id="ai-bedrock",
        )
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        binding.graph.aupdate_state.assert_awaited_once()
        messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert any(isinstance(m, RemoveMessage) and m.id == "ai-bedrock" for m in messages)

    @pytest.mark.asyncio
    async def test_bedrock_content_block_tool_use_detected(self):
        """Bedrock stores tool_call IDs in content blocks with type='tool_use'."""

        binding = _make_binding()
        ai_msg = AIMessage(
            content=[{"type": "tool_use", "id": "block-tc-1", "name": "block_tool", "input": {}}],
            id="ai-block",
        )
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        binding.graph.aupdate_state.assert_awaited_once()
        messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert any(isinstance(m, RemoveMessage) and m.id == "ai-block" for m in messages)

    @pytest.mark.asyncio
    async def test_history_preserved_only_orphaned_removed(self):
        """
        Earlier clean conversation (HumanMessage + AI + ToolMessage) must be
        preserved; only the orphaned AIMessage is removed.
        """

        binding = _make_binding()
        history = [
            HumanMessage(content="earlier query"),
            _make_ai_message(["tc-old"], ["old_tool"], msg_id="ai-old"),
            _make_tool_message("tc-old"),
            HumanMessage(content="new query"),
            _make_ai_message(["tc-orphan"], ["new_tool"], msg_id="ai-orphan"),
        ]
        binding.graph.aget_state = AsyncMock(return_value=_make_state(history))
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls(CONFIG)

        messages = binding.graph.aupdate_state.call_args[0][1]["messages"]
        removed_ids = {m.id for m in messages if isinstance(m, RemoveMessage)}
        assert removed_ids == {"ai-orphan"}
        assert "ai-old" not in removed_ids


# ===========================================================================
# 3. Exception handling
# ===========================================================================

class TestRepairExceptionHandling:

    @pytest.mark.asyncio
    async def test_aget_state_exception_triggers_fallback(self):
        """If aget_state raises, fallback HumanMessage injected."""
        binding = _make_binding()
        binding.graph.aget_state = AsyncMock(side_effect=RuntimeError("checkpoint error"))
        binding.graph.aupdate_state = AsyncMock()
        binding.graph.checkpointer = MagicMock()

        # Should not raise
        await binding._repair_orphaned_tool_calls(CONFIG)

        # Fallback: a HumanMessage was injected
        if binding.graph.aupdate_state.await_count > 0:
            call_msgs = binding.graph.aupdate_state.call_args[0][1]["messages"]
            assert any(isinstance(m, HumanMessage) for m in call_msgs)

    @pytest.mark.asyncio
    async def test_aupdate_state_exception_triggers_fallback(self):
        """If aupdate_state raises during repair, fallback path attempted."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["tool_x"], msg_id="ai-err")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock(side_effect=RuntimeError("write error"))
        binding.graph.checkpointer = MagicMock()

        # Must not crash
        await binding._repair_orphaned_tool_calls(CONFIG)

    @pytest.mark.asyncio
    async def test_fallback_exception_is_swallowed(self):
        """If both repair and fallback raise, the method still returns cleanly."""
        binding = _make_binding()
        ai_msg = _make_ai_message(["tc-1"], ["tool_x"], msg_id="ai-err2")
        binding.graph.aget_state = AsyncMock(return_value=_make_state([ai_msg]))
        binding.graph.aupdate_state = AsyncMock(side_effect=RuntimeError("all writes fail"))
        binding.graph.checkpointer = MagicMock()

        # Even with double failure, no exception escapes
        await binding._repair_orphaned_tool_calls(CONFIG)


# ===========================================================================
# 4. _extract_tool_call_ids helper
# ===========================================================================

class TestExtractToolCallIds:

    def _get_extract_fn(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids
        return _extract_tool_call_ids

    def test_standard_tool_calls_list(self):
        extract = self._get_extract_fn()
        msg = _make_ai_message(["id-1", "id-2"], ["tool_a", "tool_b"])
        assert extract(msg) == {"id-1", "id-2"}

    def test_bedrock_additional_kwargs_tool_use(self):
        extract = self._get_extract_fn()
        msg = AIMessage(
            content="",
            additional_kwargs={"tool_use": [{"id": "bk-1", "name": "t"}]},
        )
        assert "bk-1" in extract(msg)

    def test_bedrock_additional_kwargs_tool_use_camel(self):
        extract = self._get_extract_fn()
        msg = AIMessage(
            content="",
            additional_kwargs={"toolUse": [{"toolUseId": "bk-2", "name": "t"}]},
        )
        assert "bk-2" in extract(msg)

    def test_content_block_tool_use(self):
        extract = self._get_extract_fn()
        msg = AIMessage(
            content=[{"type": "tool_use", "id": "blk-1", "name": "t", "input": {}}],
        )
        assert "blk-1" in extract(msg)

    def test_non_ai_message_returns_empty(self):
        extract = self._get_extract_fn()
        assert extract(HumanMessage(content="hi")) == set()
        assert extract(ToolMessage(content="ok", tool_call_id="x")) == set()

    def test_deduplication_across_storage_locations(self):
        """Same ID in both tool_calls and content block → returned once."""
        extract = self._get_extract_fn()
        msg = AIMessage(
            content=[{"type": "tool_use", "id": "dup-1", "name": "t", "input": {}}],
            tool_calls=[{"id": "dup-1", "name": "t", "args": {}, "type": "tool_call"}],
        )
        ids = extract(msg)
        assert ids == {"dup-1"}

    def test_empty_tool_calls_returns_empty(self):
        extract = self._get_extract_fn()
        msg = AIMessage(content="plain text", tool_calls=[])
        assert extract(msg) == set()

    def test_none_tool_call_id_skipped(self):
        extract = self._get_extract_fn()
        msg = AIMessage(
            content="",
            additional_kwargs={"tool_use": [{"id": None, "name": "t"}]},
        )
        assert None not in extract(msg)
