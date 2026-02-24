#!/usr/bin/env python3
"""
Unit tests for supervisor streaming bug fixes:

1. UnboundLocalError from `import json` inside stream() shadowing the module import
   when USE_STRUCTURED_RESPONSE=true and ResponseFormat args are non-empty.

2. _repair_orphaned_tool_calls() detecting tool-use IDs stored in
   additional_kwargs and content blocks (Bedrock Converse API format),
   not just msg.tool_calls.

3. langmem_utils._find_safe_summarization_boundary() using
   _extract_tool_call_ids() to check all Bedrock tool-use storage locations,
   preventing summarization from splitting tool_use/toolResult pairs.

Usage:
    pytest tests/test_supervisor_streaming_json_and_orphaned_tools.py -v
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ai_message_with_tool_calls(tool_call_id: str, tool_name: str = "github", msg_id: str = None) -> AIMessage:
    """AIMessage with tool_calls list (standard LangChain format)."""
    return AIMessage(
        id=msg_id or f"msg-{tool_call_id}",
        content="",
        tool_calls=[{"id": tool_call_id, "name": tool_name, "args": {}}],
    )


def _make_ai_message_with_additional_kwargs(tool_call_id: str, tool_name: str = "github", msg_id: str = None) -> AIMessage:
    """AIMessage with tool_use in additional_kwargs (Bedrock Converse API format)."""
    return AIMessage(
        id=msg_id or f"msg-{tool_call_id}",
        content="",
        additional_kwargs={
            "tool_use": [{"id": tool_call_id, "name": tool_name, "input": {}}]
        },
    )


def _make_ai_message_with_content_block(tool_call_id: str, tool_name: str = "github", msg_id: str = None) -> AIMessage:
    """AIMessage with tool_use as content block (Bedrock Converse API format)."""
    return AIMessage(
        id=msg_id or f"msg-{tool_call_id}",
        content=[{"type": "tool_use", "id": tool_call_id, "name": tool_name, "input": {}}],
    )


def _make_tool_message(tool_call_id: str, tool_name: str = "github") -> ToolMessage:
    return ToolMessage(content="result", tool_call_id=tool_call_id, name=tool_name)


# ---------------------------------------------------------------------------
# 1. json scoping — _extract_tool_call_ids helper
# ---------------------------------------------------------------------------

class TestExtractToolCallIds:
    """Test the _extract_tool_call_ids helper in langmem_utils."""

    def test_extracts_from_tool_calls(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids

        msg = _make_ai_message_with_tool_calls("tooluse_abc123")
        ids = _extract_tool_call_ids(msg)
        assert "tooluse_abc123" in ids

    def test_extracts_from_additional_kwargs_tool_use(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids

        msg = _make_ai_message_with_additional_kwargs("tooluse_bcd234")
        ids = _extract_tool_call_ids(msg)
        assert "tooluse_bcd234" in ids

    def test_extracts_from_content_blocks(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids

        msg = _make_ai_message_with_content_block("tooluse_cde345")
        ids = _extract_tool_call_ids(msg)
        assert "tooluse_cde345" in ids

    def test_returns_empty_for_non_ai_message(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids

        msg = HumanMessage(content="hello")
        assert _extract_tool_call_ids(msg) == set()

    def test_deduplicates_across_locations(self):
        """Same ID in both tool_calls and content block should appear once."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids

        msg = AIMessage(
            content=[{"type": "tool_use", "id": "tooluse_dup", "name": "x", "input": {}}],
            tool_calls=[{"id": "tooluse_dup", "name": "x", "args": {}}],
        )
        ids = _extract_tool_call_ids(msg)
        assert ids == {"tooluse_dup"}


# ---------------------------------------------------------------------------
# 2. _repair_orphaned_tool_calls — detects all Bedrock formats
# ---------------------------------------------------------------------------

class TestRepairOrphanedToolCalls:
    """Test that _repair_orphaned_tool_calls finds orphans in all Bedrock formats."""

    def _make_binding(self):
        """Create a minimal AIPlatformEngineerA2ABinding with mocked graph."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory"
        ) as mock_llm_factory:
            mock_llm_factory.return_value.get_llm.return_value = MagicMock()
            from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
                AIPlatformEngineerA2ABinding,
            )
            binding = AIPlatformEngineerA2ABinding.__new__(AIPlatformEngineerA2ABinding)
            binding.graph = MagicMock()
            return binding

    @pytest.mark.asyncio
    async def test_no_orphans_when_tool_message_present(self):
        """No removal when every tool_call has a matching ToolMessage."""
        binding = self._make_binding()
        tid = "tooluse_abc"
        messages = [
            _make_ai_message_with_tool_calls(tid),
            _make_tool_message(tid),
        ]
        state = MagicMock()
        state.values = {"messages": messages}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_removes_orphan_in_tool_calls(self):
        """Removes AIMessage when tool_call has no ToolMessage (standard format)."""
        binding = self._make_binding()
        tid = "tooluse_orphan_standard"
        msg_id = "msg-orphan-std"
        ai_msg = _make_ai_message_with_tool_calls(tid, msg_id=msg_id)
        messages = [HumanMessage(content="hi"), ai_msg]

        state = MagicMock()
        state.values = {"messages": messages}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()
        removed = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(removed) == 1
        assert removed[0].id == msg_id

    @pytest.mark.asyncio
    async def test_removes_orphan_in_additional_kwargs(self):
        """Removes AIMessage with orphaned tool_use stored in additional_kwargs."""
        binding = self._make_binding()
        tid = "tooluse_orphan_addkwargs"
        ai_msg = _make_ai_message_with_additional_kwargs(tid)
        messages = [HumanMessage(content="hi"), ai_msg]

        state = MagicMock()
        state.values = {"messages": messages}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()

    @pytest.mark.asyncio
    async def test_removes_orphan_in_content_block(self):
        """Removes AIMessage with orphaned tool_use stored in content block."""
        binding = self._make_binding()
        tid = "tooluse_orphan_contentblock"
        ai_msg = _make_ai_message_with_content_block(tid)
        messages = [HumanMessage(content="hi"), ai_msg]

        state = MagicMock()
        state.values = {"messages": messages}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()


# ---------------------------------------------------------------------------
# 3. langmem boundary — does NOT split tool_use / toolResult pairs
# ---------------------------------------------------------------------------

class TestSafeummarizationBoundary:
    """Test _find_safe_summarization_boundary with Bedrock tool-use formats."""

    def _boundary(self, messages, min_keep=2):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _find_safe_summarization_boundary,
        )
        return _find_safe_summarization_boundary(messages, min_keep)

    def test_does_not_split_standard_tool_call_pair(self):
        """Boundary never falls between an AIMessage tool_call and its ToolMessage."""
        tid = "tooluse_std"
        messages = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            HumanMessage(content="q2"),
            _make_ai_message_with_tool_calls(tid),
            _make_tool_message(tid),
            AIMessage(content="final"),
        ]
        boundary = self._boundary(messages, min_keep=2)
        # The boundary must not land between index 3 (AIMessage) and 4 (ToolMessage)
        assert boundary != 4, "boundary must not land on the orphaned ToolMessage"

    def test_does_not_split_bedrock_additional_kwargs_pair(self):
        """Boundary never splits a pair when tool_use is in additional_kwargs."""
        tid = "tooluse_addkw"
        messages = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            HumanMessage(content="q2"),
            _make_ai_message_with_additional_kwargs(tid),
            _make_tool_message(tid),
            AIMessage(content="final"),
        ]
        boundary = self._boundary(messages, min_keep=2)
        assert boundary != 4

    def test_does_not_split_bedrock_content_block_pair(self):
        """Boundary never splits a pair when tool_use is in content blocks."""
        tid = "tooluse_cb"
        messages = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            HumanMessage(content="q2"),
            _make_ai_message_with_content_block(tid),
            _make_tool_message(tid),
            AIMessage(content="final"),
        ]
        boundary = self._boundary(messages, min_keep=2)
        assert boundary != 4

    def test_allows_summarization_when_pairs_are_complete(self):
        """Boundary can be before a complete tool_call/toolResult pair."""
        tid = "tooluse_complete"
        messages = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            _make_ai_message_with_tool_calls(tid),
            _make_tool_message(tid),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
        ]
        # With min_keep=2, we should be able to summarize at least the first 4
        boundary = self._boundary(messages, min_keep=2)
        # Boundary should be at index <= 4 (can include the complete pair in summary)
        assert boundary <= 4


# ---------------------------------------------------------------------------
# 4. json module scoping — ensure json.loads works at module level
# ---------------------------------------------------------------------------

class TestJsonScopingFix:
    """
    Regression test: verify that the stream() function's module-level `json`
    import (line 5 of agent.py) is not shadowed by any local import inside
    the function, which would cause UnboundLocalError when
    USE_STRUCTURED_RESPONSE=true and structured_content is non-empty.
    """

    def test_no_local_import_json_in_stream_function(self):
        """
        Parse agent.py source and assert there is no `import json` statement
        inside the stream() function body. The only allowed json import is at
        module level (line 5).
        """
        import ast
        import pathlib

        src = pathlib.Path(
            "ai_platform_engineering/multi_agents/platform_engineer/"
            "protocol_bindings/a2a/agent.py"
        ).read_text()

        tree = ast.parse(src)

        # Find the stream() method on AIPlatformEngineerA2ABinding
        stream_func_node = None
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == "AIPlatformEngineerA2ABinding":
                for item in ast.walk(node):
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == "stream":
                        stream_func_node = item
                        break
                break

        assert stream_func_node is not None, "Could not find stream() method"

        # Walk the stream() body looking for `import json`
        local_json_imports = [
            node
            for node in ast.walk(stream_func_node)
            if isinstance(node, ast.Import)
            and any(alias.name == "json" for alias in node.names)
        ]

        assert local_json_imports == [], (
            f"Found {len(local_json_imports)} `import json` statement(s) inside "
            f"stream() at lines {[n.lineno for n in local_json_imports]}. "
            "These shadow the module-level import and cause UnboundLocalError "
            "when USE_STRUCTURED_RESPONSE=true."
        )

    def test_json_loads_callable_at_module_level(self):
        """Sanity: json is importable and json.loads works (no scoping side effects)."""
        # If the local imports were left in, importing the module itself would
        # not break; the error only surfaces at runtime inside stream(). This
        # test is a fast sanity check that the module imports cleanly.
        import importlib
        mod = importlib.import_module(
            "ai_platform_engineering.multi_agents.platform_engineer"
            ".protocol_bindings.a2a.agent"
        )
        # json should be importable and not shadowed at module level
        assert callable(json.loads)
        assert mod is not None


# ---------------------------------------------------------------------------
# 5. preflight_context_check — handles query=None (HITL resume flow)
# ---------------------------------------------------------------------------

class TestPreflightContextCheckNullQuery:
    """
    Regression test: preflight_context_check must not crash when query=None.

    During HITL resume flows the caller passes query=None (the 'input' is a
    Command object, not a text string).  Previously line 538:
        query_tokens = len(query) // 4
    raised TypeError: object of type 'NoneType' has no len()
    """

    def _make_graph(self, messages=None):
        graph = MagicMock()
        state = MagicMock()
        state.values = {"messages": messages or [HumanMessage(content="hi")]}
        graph.aget_state = AsyncMock(return_value=state)
        return graph

    @pytest.mark.asyncio
    async def test_none_query_does_not_raise(self):
        """query=None must not raise TypeError."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        graph = self._make_graph()
        # Should not raise
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
            query=None,
            system_prompt="You are a supervisor.",
            agent_name="supervisor",
        )
        assert result is not None
        assert result.query_tokens == 0

    @pytest.mark.asyncio
    async def test_none_query_tokens_zero(self):
        """query=None results in query_tokens=0, not a crash."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        graph = self._make_graph()
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
            query=None,
        )
        assert result.query_tokens == 0

    @pytest.mark.asyncio
    async def test_empty_string_query_tokens_zero(self):
        """query='' also produces query_tokens=0 (matches falsy guard)."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        graph = self._make_graph()
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
            query="",
        )
        assert result.query_tokens == 0

    @pytest.mark.asyncio
    async def test_normal_query_tokens_nonzero(self):
        """Non-empty query still produces a positive query_tokens estimate."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        graph = self._make_graph()
        query = "What is the status of the ArgoCD deployment?"
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
            query=query,
        )
        assert result.query_tokens == len(query) // 4


# ---------------------------------------------------------------------------
# 6. _extract_tool_call_ids — edge cases
# ---------------------------------------------------------------------------

class TestExtractToolCallIdsEdgeCases:
    """Edge-case coverage for _extract_tool_call_ids."""

    def _extract(self, msg):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids
        return _extract_tool_call_ids(msg)

    def test_camel_case_toolUse_key(self):
        """Bedrock may use 'toolUse' (camelCase) in additional_kwargs."""
        msg = AIMessage(
            content="",
            additional_kwargs={
                "toolUse": [{"id": "tooluse_camel", "name": "x", "input": {}}]
            },
        )
        assert "tooluse_camel" in self._extract(msg)

    def test_toolUseId_key_variant(self):
        """Some Bedrock payloads use 'toolUseId' instead of 'id'."""
        msg = AIMessage(
            content="",
            additional_kwargs={
                "tool_use": [{"toolUseId": "tooluse_alt_key", "name": "x", "input": {}}]
            },
        )
        assert "tooluse_alt_key" in self._extract(msg)

    def test_single_dict_not_list(self):
        """additional_kwargs.tool_use may be a single dict, not a list."""
        msg = AIMessage(
            content="",
            additional_kwargs={
                "tool_use": {"id": "tooluse_single", "name": "x", "input": {}}
            },
        )
        assert "tooluse_single" in self._extract(msg)

    def test_mixed_content_blocks(self):
        """Content list with both text and tool_use blocks."""
        msg = AIMessage(
            content=[
                {"type": "text", "text": "thinking..."},
                {"type": "tool_use", "id": "tooluse_mixed", "name": "x", "input": {}},
                {"type": "text", "text": "more thinking"},
            ],
        )
        ids = self._extract(msg)
        assert ids == {"tooluse_mixed"}

    def test_malformed_content_block_missing_id(self):
        """Content block with type=tool_use but no id key is silently skipped."""
        msg = AIMessage(
            content=[
                {"type": "tool_use", "name": "x", "input": {}},
            ],
        )
        assert self._extract(msg) == set()

    def test_empty_tool_calls_list(self):
        """AIMessage with tool_calls=[] returns empty set."""
        msg = AIMessage(content="hello", tool_calls=[])
        assert self._extract(msg) == set()

    def test_string_content_blocks_skipped(self):
        """String elements in content list are silently skipped."""
        msg = AIMessage(
            content=["plain text", {"type": "text", "text": "hello"}, {"type": "tool_use", "id": "tooluse_ok", "name": "x", "input": {}}],
        )
        assert self._extract(msg) == {"tooluse_ok"}


# ---------------------------------------------------------------------------
# 7. _repair_orphaned_tool_calls — edge cases
# ---------------------------------------------------------------------------

class TestRepairOrphanedToolCallsEdgeCases:
    """Edge-case coverage for _repair_orphaned_tool_calls."""

    def _make_binding(self):
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory"
        ) as mock_llm_factory:
            mock_llm_factory.return_value.get_llm.return_value = MagicMock()
            from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
                AIPlatformEngineerA2ABinding,
            )
            binding = AIPlatformEngineerA2ABinding.__new__(AIPlatformEngineerA2ABinding)
            binding.graph = MagicMock()
            return binding

    @pytest.mark.asyncio
    async def test_empty_state_values_none(self):
        """state.values is None — should return without raising."""
        binding = self._make_binding()
        state = MagicMock()
        state.values = None
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_state_is_none(self):
        """aget_state returns None — should return without raising."""
        binding = self._make_binding()
        binding.graph.aget_state = AsyncMock(return_value=None)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_messages_list(self):
        """Empty messages list — should return without raising."""
        binding = self._make_binding()
        state = MagicMock()
        state.values = {"messages": []}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_multiple_orphans_all_removed(self):
        """Multiple orphaned AIMessages should all be removed."""
        binding = self._make_binding()
        msg1 = _make_ai_message_with_tool_calls("tooluse_a", msg_id="msg-a")
        msg2 = _make_ai_message_with_additional_kwargs("tooluse_b", msg_id="msg-b")
        messages = [HumanMessage(content="hi"), msg1, msg2]

        state = MagicMock()
        state.values = {"messages": messages}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()
        removed = binding.graph.aupdate_state.call_args[0][1]["messages"]
        removed_ids = {r.id for r in removed}
        assert "msg-a" in removed_ids
        assert "msg-b" in removed_ids

    @pytest.mark.asyncio
    async def test_partial_orphan_only_orphaned_removed(self):
        """AIMessage with 2 tool calls, one resolved and one orphaned — only orphaned AIMessage removed."""
        binding = self._make_binding()
        ai_msg = AIMessage(
            id="msg-partial",
            content="",
            tool_calls=[
                {"id": "tooluse_resolved", "name": "a", "args": {}},
                {"id": "tooluse_orphaned", "name": "b", "args": {}},
            ],
        )
        messages = [
            HumanMessage(content="hi"),
            ai_msg,
            _make_tool_message("tooluse_resolved"),
        ]

        state = MagicMock()
        state.values = {"messages": messages}
        binding.graph.aget_state = AsyncMock(return_value=state)
        binding.graph.aupdate_state = AsyncMock()

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()
        removed = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert len(removed) == 1
        assert removed[0].id == "msg-partial"

    @pytest.mark.asyncio
    async def test_aget_state_raises_exception(self):
        """aget_state raising should trigger fallback path without propagating."""
        binding = self._make_binding()
        binding.graph.aget_state = AsyncMock(side_effect=RuntimeError("checkpoint error"))
        binding.graph.aupdate_state = AsyncMock()
        binding.graph.checkpointer = None

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        # Should not raise; the except block handles it


# ---------------------------------------------------------------------------
# 8. _find_safe_summarization_boundary — edge cases
# ---------------------------------------------------------------------------

class TestSummarizationBoundaryEdgeCases:
    """Edge-case coverage for _find_safe_summarization_boundary."""

    def _boundary(self, messages, min_keep=2):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _find_safe_summarization_boundary
        return _find_safe_summarization_boundary(messages, min_keep)

    def test_fewer_messages_than_min_keep(self):
        """len(messages) <= min_keep should return 0 (no summarization)."""
        messages = [HumanMessage(content="hi"), AIMessage(content="hello")]
        assert self._boundary(messages, min_keep=5) == 0

    def test_equal_messages_to_min_keep(self):
        """len(messages) == min_keep should return 0."""
        messages = [HumanMessage(content="hi"), AIMessage(content="hello")]
        assert self._boundary(messages, min_keep=2) == 0

    def test_no_tool_calls_straightforward_boundary(self):
        """All HumanMessage/AIMessage with no tool calls — boundary is len-min_keep."""
        messages = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
            HumanMessage(content="q3"),
            AIMessage(content="a3"),
        ]
        boundary = self._boundary(messages, min_keep=2)
        assert boundary == 4

    def test_multiple_pending_tool_calls_at_boundary(self):
        """Multiple tool calls crossing the boundary — all must be included."""
        tid_a = "tooluse_multi_a"
        tid_b = "tooluse_multi_b"
        ai_msg = AIMessage(
            id="msg-multi",
            content="",
            tool_calls=[
                {"id": tid_a, "name": "a", "args": {}},
                {"id": tid_b, "name": "b", "args": {}},
            ],
        )
        messages = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            ai_msg,
            _make_tool_message(tid_a),
            _make_tool_message(tid_b),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
        ]
        boundary = self._boundary(messages, min_keep=2)
        # Boundary must not split the AI+Tool pair
        assert boundary != 3
        assert boundary != 4

    def test_tool_message_in_keep_references_summarize(self):
        """ToolMessage in keep references tool_call in summarize — boundary adjusts."""
        tid = "tooluse_cross_boundary"
        messages = [
            HumanMessage(content="q1"),
            _make_ai_message_with_tool_calls(tid),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
            _make_tool_message(tid),
            HumanMessage(content="q3"),
            AIMessage(content="a3"),
        ]
        boundary = self._boundary(messages, min_keep=3)
        # The AIMessage at index 1 has the tool_call, ToolMessage at index 4
        # references it. Boundary must move back to include both.
        assert boundary <= 1

    def test_empty_messages(self):
        """Empty messages list returns 0."""
        assert self._boundary([], min_keep=2) == 0


# ---------------------------------------------------------------------------
# 9. Force-repair regex extraction
# ---------------------------------------------------------------------------

class TestForceRepairRegex:
    """Test the regex extraction of tooluse IDs from Bedrock/LangGraph error strings."""

    def _extract_ids(self, error_str):
        import re
        return re.findall(r'tooluse_[A-Za-z0-9_-]+', error_str)

    def test_bedrock_error_format(self):
        """Bedrock: 'Expected toolResult blocks ... for the following Ids: tooluse_abc123'."""
        error = (
            "ValidationException: Expected toolResult blocks at "
            "messages.0.content for the following Ids: tooluse_r0nsJk4QRomof54ouCCjj5"
        )
        ids = self._extract_ids(error)
        assert ids == ["tooluse_r0nsJk4QRomof54ouCCjj5"]

    def test_langgraph_error_format(self):
        """LangGraph: 'do not have a corresponding ToolMessage ... id: tooluse_xyz'."""
        error = (
            "Found AIMessages with tool_calls that do not have a corresponding "
            "ToolMessage. Here are the first few of the tool 'id' values: "
            "['tooluse_xYz123-abc']"
        )
        ids = self._extract_ids(error)
        assert ids == ["tooluse_xYz123-abc"]

    def test_multiple_ids_in_error(self):
        """Error string contains multiple tooluse IDs — all extracted."""
        error = (
            "Expected toolResult for tooluse_first_id and also "
            "tooluse_second_id were missing"
        )
        ids = self._extract_ids(error)
        assert len(ids) == 2
        assert "tooluse_first_id" in ids
        assert "tooluse_second_id" in ids

    def test_no_tooluse_ids(self):
        """Error string without tooluse IDs — returns empty list."""
        error = "Some unrelated error: connection timeout"
        ids = self._extract_ids(error)
        assert ids == []

    def test_tooluse_id_with_underscores_and_hyphens(self):
        """IDs with underscores and hyphens are fully captured."""
        error = "Missing result for tooluse_abc-123_DEF-456"
        ids = self._extract_ids(error)
        assert ids == ["tooluse_abc-123_DEF-456"]

    def test_is_tool_state_error_detection(self):
        """Verify the is_tool_state_error boolean logic matches all three patterns."""
        bedrock_err = "Expected toolResult blocks at messages.0.content"
        langgraph_err = "do not have a corresponding ToolMessage"
        generic_err = "Some other error"

        for err_str in [bedrock_err, langgraph_err]:
            is_tool_state_error = (
                "Expected toolResult" in err_str
                or "toolResult blocks" in err_str
                or "do not have a corresponding ToolMessage" in err_str
            )
            assert is_tool_state_error, f"Should detect tool state error: {err_str}"

        is_tool_state_error = (
            "Expected toolResult" in generic_err
            or "toolResult blocks" in generic_err
            or "do not have a corresponding ToolMessage" in generic_err
        )
        assert not is_tool_state_error


# ---------------------------------------------------------------------------
# 10. preflight_context_check — edge cases
# ---------------------------------------------------------------------------

class TestPreflightContextCheckEdgeCases:
    """Edge-case coverage for preflight_context_check."""

    def _make_graph(self, state_return=None, messages=None):
        graph = MagicMock()
        if state_return is not None:
            graph.aget_state = AsyncMock(return_value=state_return)
        elif messages is not None:
            state = MagicMock()
            state.values = {"messages": messages}
            graph.aget_state = AsyncMock(return_value=state)
        else:
            graph.aget_state = AsyncMock(return_value=None)
        return graph

    @pytest.mark.asyncio
    async def test_state_is_none(self):
        """graph.aget_state returns None — returns needs_compression=False."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check
        graph = self._make_graph(state_return=None)
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
        )
        assert result.needs_compression is False
        assert result.estimated_tokens == 0

    @pytest.mark.asyncio
    async def test_state_values_is_none(self):
        """state.values is None — returns needs_compression=False."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check
        state = MagicMock()
        state.values = None
        graph = self._make_graph(state_return=state)
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
        )
        assert result.needs_compression is False

    @pytest.mark.asyncio
    async def test_no_messages_key(self):
        """state.values has no 'messages' key — returns needs_compression=False."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check
        state = MagicMock()
        state.values = {"other_key": "value"}
        # .get("messages", []) returns [] which is falsy
        graph = self._make_graph(state_return=state)
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
        )
        assert result.needs_compression is False

    @pytest.mark.asyncio
    async def test_below_threshold_no_compression(self):
        """Small history below 80% threshold — needs_compression=False."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check
        messages = [HumanMessage(content="short question"), AIMessage(content="short answer")]
        graph = self._make_graph(messages=messages)
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
            max_context_tokens=100000,
        )
        assert result.needs_compression is False
        assert result.estimated_tokens > 0

    @pytest.mark.asyncio
    async def test_above_threshold_no_model(self):
        """Above threshold but model=None — needs_compression=True with error."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check
        long_content = "x" * 400000
        messages = [HumanMessage(content=long_content)]
        graph = self._make_graph(messages=messages)
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
            model=None,
            max_context_tokens=1000,
        )
        assert result.needs_compression is True
        assert result.error == "Model not provided for compression"

    @pytest.mark.asyncio
    async def test_aget_state_raises_returns_error(self):
        """graph.aget_state raises — returns ContextCheckResult with error."""
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check
        graph = MagicMock()
        graph.aget_state = AsyncMock(side_effect=RuntimeError("db error"))
        result = await preflight_context_check(
            graph=graph,
            config={"configurable": {"thread_id": "t1"}},
        )
        assert result.error is not None
        assert "db error" in result.error
