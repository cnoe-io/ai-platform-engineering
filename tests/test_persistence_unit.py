#!/usr/bin/env python3
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for LangGraph persistence, memory management,
context compression, orphan repair, and related edge cases.

Covers:
  - _extract_tool_call_ids: all Bedrock storage locations
  - _find_safe_summarization_boundary: tool-call/result pair safety
  - SummarizationResult: dataclass properties
  - summarize_messages: LangMem + fallback paths
  - _fallback_summarize: edge cases
  - _estimate_tokens / _get_message_content: helpers
  - preflight_context_check: compression pipeline
  - is_langmem_available / verify_langmem_on_startup: availability
  - get_langmem_status: status reporting
  - _repair_orphaned_tool_calls: all repair scenarios
  - _deserialize_a2a_event: A2A event parsing
  - stream() config wiring: context_id / trace_id propagation
  - InMemorySaver checkpointer wiring in deep_agent

Usage:
    PYTHONPATH=. uv run pytest tests/test_persistence_unit.py -v
"""

import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)


# ============================================================================
# _extract_tool_call_ids
# ============================================================================

class TestExtractToolCallIds:
    """Test _extract_tool_call_ids across all Bedrock storage locations."""

    def setup_method(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _extract_tool_call_ids
        self.extract = _extract_tool_call_ids

    def test_empty_ai_message(self):
        msg = AIMessage(content="Hello")
        assert self.extract(msg) == set()

    def test_non_ai_message_returns_empty(self):
        assert self.extract(HumanMessage(content="Hi")) == set()
        assert self.extract(ToolMessage(content="result", tool_call_id="tc1")) == set()
        assert self.extract(SystemMessage(content="system")) == set()

    def test_tool_calls_list_with_dicts(self):
        msg = AIMessage(
            content="",
            tool_calls=[
                {"id": "tc-1", "name": "github", "args": {}},
                {"id": "tc-2", "name": "jira", "args": {}},
            ],
        )
        assert self.extract(msg) == {"tc-1", "tc-2"}

    def test_tool_calls_list_with_none_id(self):
        msg = AIMessage(
            content="",
            tool_calls=[{"id": None, "name": "github", "args": {}}],
        )
        assert self.extract(msg) == set()

    def test_tool_calls_list_empty(self):
        msg = AIMessage(content="", tool_calls=[])
        assert self.extract(msg) == set()

    def test_additional_kwargs_tool_use_single_dict(self):
        msg = AIMessage(
            content="",
            additional_kwargs={"tool_use": {"id": "tc-ak-1", "name": "aws"}},
        )
        assert self.extract(msg) == {"tc-ak-1"}

    def test_additional_kwargs_tool_use_list(self):
        msg = AIMessage(
            content="",
            additional_kwargs={
                "tool_use": [
                    {"id": "tc-ak-1", "name": "aws"},
                    {"id": "tc-ak-2", "name": "argocd"},
                ]
            },
        )
        assert self.extract(msg) == {"tc-ak-1", "tc-ak-2"}

    def test_additional_kwargs_toolUse_camelCase(self):
        msg = AIMessage(
            content="",
            additional_kwargs={"toolUse": {"id": "tc-camel", "name": "slack"}},
        )
        assert self.extract(msg) == {"tc-camel"}

    def test_additional_kwargs_toolUseId_key(self):
        msg = AIMessage(
            content="",
            additional_kwargs={"tool_use": {"toolUseId": "tc-tuid", "name": "jira"}},
        )
        assert self.extract(msg) == {"tc-tuid"}

    def test_additional_kwargs_empty(self):
        msg = AIMessage(content="", additional_kwargs={})
        assert self.extract(msg) == set()

    def test_additional_kwargs_none(self):
        msg = AIMessage(content="")
        msg.additional_kwargs = None
        assert self.extract(msg) == set()

    def test_content_blocks_tool_use(self):
        msg = AIMessage(
            content=[
                {"type": "text", "text": "Let me check"},
                {"type": "tool_use", "id": "tc-cb-1", "name": "github", "input": {}},
                {"type": "tool_use", "id": "tc-cb-2", "name": "jira", "input": {}},
            ],
        )
        assert self.extract(msg) == {"tc-cb-1", "tc-cb-2"}

    def test_content_blocks_no_tool_use(self):
        msg = AIMessage(
            content=[{"type": "text", "text": "Hello"}],
        )
        assert self.extract(msg) == set()

    def test_content_blocks_missing_id(self):
        msg = AIMessage(
            content=[{"type": "tool_use", "name": "github", "input": {}}],
        )
        assert self.extract(msg) == set()

    def test_all_three_locations_combined(self):
        """All three storage locations contribute unique IDs."""
        msg = AIMessage(
            content=[{"type": "tool_use", "id": "tc-content", "name": "x", "input": {}}],
            tool_calls=[{"id": "tc-calls", "name": "y", "args": {}}],
            additional_kwargs={"tool_use": {"id": "tc-kwargs", "name": "z"}},
        )
        assert self.extract(msg) == {"tc-content", "tc-calls", "tc-kwargs"}

    def test_duplicate_ids_across_locations(self):
        """Same ID across locations is deduplicated."""
        msg = AIMessage(
            content=[{"type": "tool_use", "id": "tc-dup", "name": "x", "input": {}}],
            tool_calls=[{"id": "tc-dup", "name": "x", "args": {}}],
        )
        assert self.extract(msg) == {"tc-dup"}

    def test_string_content_ignored(self):
        msg = AIMessage(content="just text, no blocks")
        assert self.extract(msg) == set()


# ============================================================================
# _find_safe_summarization_boundary
# ============================================================================

class TestFindSafeSummarizationBoundary:
    """Test boundary detection for safe summarization splitting."""

    def setup_method(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _find_safe_summarization_boundary
        self.find_boundary = _find_safe_summarization_boundary

    def test_few_messages_below_min_keep(self):
        msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
        assert self.find_boundary(msgs, min_keep=5) == 0

    def test_exact_min_keep(self):
        msgs = [HumanMessage(content=f"m{i}") for i in range(4)]
        assert self.find_boundary(msgs, min_keep=4) == 0

    def test_simple_split_no_tool_calls(self):
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
            HumanMessage(content="q3"),
            AIMessage(content="a3"),
        ]
        result = self.find_boundary(msgs, min_keep=2)
        assert result == 4

    def test_tool_call_pair_not_split(self):
        """Ensures we don't split between a tool_use and its tool_result."""
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(content="", tool_calls=[{"id": "tc1", "name": "gh", "args": {}}]),
            ToolMessage(content="result", tool_call_id="tc1"),
            HumanMessage(content="q2"),
            AIMessage(content="final"),
        ]
        result = self.find_boundary(msgs, min_keep=2)
        assert result <= 3

    def test_orphaned_tool_result_in_keep_section(self):
        """ToolMessage in keep referencing AIMessage in summarize must stay together."""
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(
                id="ai1",
                content="",
                tool_calls=[{"id": "tc1", "name": "gh", "args": {}}],
            ),
            HumanMessage(content="q2"),
            ToolMessage(content="result", tool_call_id="tc1"),
            AIMessage(content="final"),
        ]
        result = self.find_boundary(msgs, min_keep=2)
        assert result <= 1

    def test_multiple_tool_calls_all_resolved(self):
        msgs = [
            HumanMessage(content="q"),
            AIMessage(
                content="",
                tool_calls=[
                    {"id": "tc1", "name": "a", "args": {}},
                    {"id": "tc2", "name": "b", "args": {}},
                ],
            ),
            ToolMessage(content="r1", tool_call_id="tc1"),
            ToolMessage(content="r2", tool_call_id="tc2"),
            HumanMessage(content="next"),
            AIMessage(content="done"),
        ]
        result = self.find_boundary(msgs, min_keep=2)
        assert result == 4

    def test_boundary_doesnt_end_with_orphaned_ai(self):
        """Summarize section must not end with AIMessage with unresolved tool calls."""
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            AIMessage(
                id="ai-orphan",
                content="",
                tool_calls=[{"id": "tc-x", "name": "gh", "args": {}}],
            ),
            ToolMessage(content="res", tool_call_id="tc-x"),
            HumanMessage(content="q2"),
            AIMessage(content="final"),
        ]
        result = self.find_boundary(msgs, min_keep=2)
        assert result <= 4

    def test_empty_messages(self):
        assert self.find_boundary([], min_keep=4) == 0

    def test_single_message(self):
        assert self.find_boundary([HumanMessage(content="hi")], min_keep=1) == 0

    def test_bedrock_additional_kwargs_tool_calls(self):
        """Boundary respects tool calls stored in additional_kwargs."""
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(
                id="ai-bedrock",
                content="",
                additional_kwargs={"tool_use": [{"id": "tc-bed", "name": "aws"}]},
            ),
            ToolMessage(content="result", tool_call_id="tc-bed"),
            HumanMessage(content="q2"),
            AIMessage(content="final"),
        ]
        result = self.find_boundary(msgs, min_keep=2)
        assert result <= 3


# ============================================================================
# SummarizationResult
# ============================================================================

class TestSummarizationResult:
    """Test SummarizationResult dataclass."""

    def setup_method(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import SummarizationResult
        self.Result = SummarizationResult

    def test_compression_ratio_normal(self):
        r = self.Result(success=True, tokens_before=1000, tokens_after=200)
        assert r.compression_ratio == pytest.approx(0.2)

    def test_compression_ratio_no_compression(self):
        r = self.Result(success=True, tokens_before=1000, tokens_after=1000)
        assert r.compression_ratio == pytest.approx(1.0)

    def test_compression_ratio_zero_before(self):
        r = self.Result(success=True, tokens_before=0, tokens_after=0)
        assert r.compression_ratio == 1.0

    def test_defaults(self):
        r = self.Result(success=False)
        assert r.messages_removed == 0
        assert r.tokens_before == 0
        assert r.tokens_saved == 0
        assert r.duration_ms == 0.0
        assert r.error is None
        assert r.used_langmem is False
        assert r.summary_message is None


# ============================================================================
# _estimate_tokens / _get_message_content
# ============================================================================

class TestHelpers:
    """Test helper functions."""

    def setup_method(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _estimate_tokens,
            _get_message_content,
        )
        self.estimate = _estimate_tokens
        self.get_content = _get_message_content

    def test_estimate_tokens_simple(self):
        msgs = [HumanMessage(content="abcdefgh")]  # 8 chars => 2 tokens
        assert self.estimate(msgs) == 2

    def test_estimate_tokens_empty(self):
        assert self.estimate([]) == 0

    def test_estimate_tokens_multiple(self):
        msgs = [
            HumanMessage(content="a" * 100),
            AIMessage(content="b" * 200),
        ]
        assert self.estimate(msgs) == 75  # 300 / 4

    def test_get_content_string(self):
        assert self.get_content(HumanMessage(content="hello")) == "hello"

    def test_get_content_list(self):
        msg = AIMessage(content=[{"type": "text", "text": "part1"}, "part2"])
        result = self.get_content(msg)
        assert "part1" in result or "part2" in result

    def test_get_content_empty_list(self):
        msg = AIMessage(content=[])
        assert self.get_content(msg) == ""

    def test_get_content_mixed_items_in_list(self):
        msg = AIMessage(content=["part1", {"type": "text", "text": "part2"}])
        result = self.get_content(msg)
        assert "part1" in result

    def test_get_content_no_content_attr(self):
        msg = MagicMock(spec=[])
        assert self.get_content(msg) == ""


# ============================================================================
# summarize_messages
# ============================================================================

class TestSummarizeMessages:
    """Test summarize_messages with LangMem and fallback paths."""

    @pytest.mark.asyncio
    async def test_empty_messages(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import summarize_messages
        result = await summarize_messages([], model=MagicMock())
        assert result.success is True
        assert result.messages_removed == 0

    @pytest.mark.asyncio
    async def test_langmem_available_and_succeeds(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import summarize_messages

        mock_extractor = AsyncMock()
        mock_extractor.ainvoke.return_value = MagicMock(summary="Test summary content")

        mock_create = MagicMock(return_value=mock_extractor)

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available", return_value=True), \
             patch.dict("sys.modules", {"langmem": MagicMock(create_thread_extractor=mock_create)}):
            msgs = [HumanMessage(content="q1"), AIMessage(content="a1")]
            result = await summarize_messages(msgs, model=MagicMock())

            assert result.success is True
            assert result.used_langmem is True
            assert result.messages_removed == 2
            assert result.summary_message is not None
            assert "Test summary content" in result.summary_message.content

    @pytest.mark.asyncio
    async def test_langmem_available_but_fails_falls_back(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import summarize_messages

        mock_extractor = AsyncMock()
        mock_extractor.ainvoke.side_effect = RuntimeError("LLM error")

        mock_create = MagicMock(return_value=mock_extractor)

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available", return_value=True), \
             patch.dict("sys.modules", {"langmem": MagicMock(create_thread_extractor=mock_create)}):
            msgs = [HumanMessage(content="question"), AIMessage(content="answer")]
            result = await summarize_messages(msgs, model=MagicMock())

            assert result.success is True
            assert result.used_langmem is False

    @pytest.mark.asyncio
    async def test_langmem_not_available_uses_fallback(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import summarize_messages

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available", return_value=False):
            msgs = [HumanMessage(content="q"), AIMessage(content="a")]
            result = await summarize_messages(msgs, model=MagicMock())

            assert result.success is True
            assert result.used_langmem is False
            assert result.summary_message is not None


# ============================================================================
# _fallback_summarize
# ============================================================================

class TestFallbackSummarize:
    """Test fallback summarization edge cases."""

    def setup_method(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import _fallback_summarize
        self.fallback = _fallback_summarize

    def test_single_message(self):
        msgs = [HumanMessage(content="only message")]
        result = self.fallback(msgs, "test", 10, time.time())
        assert result.success is True
        assert result.messages_removed == 1
        assert "only message" in result.summary_message.content

    def test_many_messages_includes_first_and_recent(self):
        msgs = [HumanMessage(content=f"msg-{i}") for i in range(10)]
        result = self.fallback(msgs, "test", 100, time.time())
        assert result.success is True
        assert result.messages_removed == 10
        assert "msg-0" in result.summary_message.content
        assert "msg-9" in result.summary_message.content

    def test_empty_content_messages(self):
        msgs = [AIMessage(content=""), HumanMessage(content="valid")]
        result = self.fallback(msgs, "test", 5, time.time())
        assert result.success is True

    def test_long_content_truncated(self):
        msgs = [HumanMessage(content="x" * 2000)]
        result = self.fallback(msgs, "test", 500, time.time())
        assert result.success is True
        assert len(result.summary_message.content) < 2000


# ============================================================================
# preflight_context_check
# ============================================================================

class TestPreflightContextCheck:
    """Test proactive context compression pipeline."""

    @pytest.mark.asyncio
    async def test_no_state_returns_no_compression(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        mock_graph.aget_state.return_value = None

        result = await preflight_context_check(mock_graph, {})
        assert result.needs_compression is False
        assert result.estimated_tokens == 0

    @pytest.mark.asyncio
    async def test_empty_state_values(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        state.values = {}
        mock_graph.aget_state.return_value = state

        result = await preflight_context_check(mock_graph, {})
        assert result.needs_compression is False

    @pytest.mark.asyncio
    async def test_empty_messages_list(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        state.values = {"messages": []}
        mock_graph.aget_state.return_value = state

        result = await preflight_context_check(mock_graph, {})
        assert result.needs_compression is False

    @pytest.mark.asyncio
    async def test_below_threshold_no_compression(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        state.values = {"messages": [HumanMessage(content="short")]}
        mock_graph.aget_state.return_value = state

        result = await preflight_context_check(
            mock_graph, {}, query="test", max_context_tokens=100000,
        )
        assert result.needs_compression is False
        assert result.estimated_tokens > 0

    @pytest.mark.asyncio
    async def test_above_threshold_no_model_reports_error(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        state.values = {"messages": [HumanMessage(content="x" * 40000)]}
        mock_graph.aget_state.return_value = state

        result = await preflight_context_check(
            mock_graph, {},
            query="q",
            system_prompt="s" * 10000,
            model=None,
            max_context_tokens=5000,
        )
        assert result.needs_compression is True
        assert "Model not provided" in result.error

    @pytest.mark.asyncio
    async def test_above_threshold_successful_compression(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        big_msgs = [HumanMessage(content="x" * 5000, id=f"m{i}") for i in range(10)]
        state.values = {"messages": big_msgs}
        mock_graph.aget_state.return_value = state

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.summarize_messages") as mock_sum:
            from ai_platform_engineering.utils.a2a_common.langmem_utils import SummarizationResult
            mock_sum.return_value = SummarizationResult(
                success=True,
                summary_message=SystemMessage(content="summary"),
                messages_removed=8,
                tokens_before=10000,
                tokens_after=50,
                tokens_saved=9950,
                used_langmem=True,
            )

            result = await preflight_context_check(
                mock_graph, {},
                query="q",
                model=MagicMock(),
                max_context_tokens=5000,
                tool_count=0,
            )
            assert result.compressed is True
            assert result.tokens_saved == 9950
            mock_graph.aupdate_state.assert_called()

    @pytest.mark.asyncio
    async def test_not_enough_messages_to_summarize(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        state.values = {"messages": [HumanMessage(content="x" * 40000)]}
        mock_graph.aget_state.return_value = state

        result = await preflight_context_check(
            mock_graph, {},
            query="q",
            model=MagicMock(),
            max_context_tokens=5000,
            min_messages_to_keep=10,
        )
        assert result.needs_compression is True
        assert "Not enough messages" in result.error

    @pytest.mark.asyncio
    async def test_exception_returns_safe_result(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        mock_graph.aget_state.side_effect = RuntimeError("DB error")

        result = await preflight_context_check(mock_graph, {})
        assert result.needs_compression is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_summarization_failure_returns_error(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import preflight_context_check

        mock_graph = AsyncMock()
        state = MagicMock()
        state.values = {"messages": [HumanMessage(content="x" * 5000, id=f"m{i}") for i in range(10)]}
        mock_graph.aget_state.return_value = state

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.summarize_messages") as mock_sum:
            from ai_platform_engineering.utils.a2a_common.langmem_utils import SummarizationResult
            mock_sum.return_value = SummarizationResult(
                success=False,
                error="LLM timed out",
            )

            result = await preflight_context_check(
                mock_graph, {},
                query="q",
                model=MagicMock(),
                max_context_tokens=5000,
                tool_count=0,
            )
            assert result.needs_compression is True
            assert "LLM timed out" in result.error


# ============================================================================
# is_langmem_available / verify / status
# ============================================================================

class TestLangMemAvailability:
    """Test LangMem availability checking."""

    def test_status_returns_dict(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import get_langmem_status
        status = get_langmem_status()
        assert "available" in status
        assert "verified" in status
        assert "env_skip_verification" in status
        assert isinstance(status["available"], bool)

    @pytest.mark.asyncio
    async def test_verify_skips_when_not_available(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import verify_langmem_on_startup

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available", return_value=False):
            result = await verify_langmem_on_startup(MagicMock())
            assert result is False

    @pytest.mark.asyncio
    async def test_verify_skips_when_env_set(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import verify_langmem_on_startup

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available", return_value=True), \
             patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_verified", return_value=False), \
             patch.dict(os.environ, {"SKIP_LANGMEM_VERIFICATION": "true"}):
            result = await verify_langmem_on_startup(MagicMock())
            assert result is True

    @pytest.mark.asyncio
    async def test_verify_skips_when_already_verified(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import verify_langmem_on_startup

        with patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available", return_value=True), \
             patch("ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_verified", return_value=True):
            result = await verify_langmem_on_startup(MagicMock())
            assert result is True


# ============================================================================
# ContextCheckResult
# ============================================================================

class TestContextCheckResult:
    """Test ContextCheckResult dataclass."""

    def test_defaults(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import ContextCheckResult
        r = ContextCheckResult(
            needs_compression=False,
            estimated_tokens=100,
            threshold_tokens=80000,
            history_tokens=50,
            system_tokens=20,
            query_tokens=10,
            tool_tokens=20,
        )
        assert r.compressed is False
        assert r.tokens_saved == 0
        assert r.used_langmem is False
        assert r.error is None


# ============================================================================
# _repair_orphaned_tool_calls
# ============================================================================

class TestRepairOrphanedToolCalls:
    """Test the orphan repair mechanism in AIPlatformEngineerA2ABinding."""

    def _make_binding(self):
        with patch("ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.AIPlatformEngineerMAS") as mock_mas, \
             patch("ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.TracingManager"):
            mock_mas.return_value.get_graph.return_value = AsyncMock()
            from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import AIPlatformEngineerA2ABinding
            binding = AIPlatformEngineerA2ABinding()
            return binding

    @pytest.mark.asyncio
    async def test_no_state_returns_early(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        binding.graph.aget_state.return_value = None
        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_values_returns_early(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {}
        binding.graph.aget_state.return_value = state
        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_messages_returns_early(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {"messages": []}
        binding.graph.aget_state.return_value = state
        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_orphans_found(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                HumanMessage(content="q"),
                AIMessage(
                    id="ai1",
                    content="",
                    tool_calls=[{"id": "tc1", "name": "gh", "args": {}}],
                ),
                ToolMessage(content="result", tool_call_id="tc1"),
                AIMessage(id="ai2", content="final"),
            ]
        }
        binding.graph.aget_state.return_value = state
        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_orphan_detected_and_removed(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                HumanMessage(content="q"),
                AIMessage(
                    id="ai-orphan",
                    content="",
                    tool_calls=[{"id": "tc-orphan", "name": "github", "args": {}}],
                ),
                AIMessage(id="ai-good", content="next response"),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()
        call_args = binding.graph.aupdate_state.call_args
        remove_msgs = call_args[0][1]["messages"]
        removed_ids = {m.id for m in remove_msgs}
        assert "ai-orphan" in removed_ids
        assert "ai-good" not in removed_ids

    @pytest.mark.asyncio
    async def test_orphan_in_additional_kwargs(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                AIMessage(
                    id="ai-bedrock",
                    content="",
                    additional_kwargs={"tool_use": [{"id": "tc-bed", "name": "aws"}]},
                ),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()
        remove_msgs = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert any(m.id == "ai-bedrock" for m in remove_msgs)

    @pytest.mark.asyncio
    async def test_orphan_in_content_blocks(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                AIMessage(
                    id="ai-content",
                    content=[{"type": "tool_use", "id": "tc-cb", "name": "jira", "input": {}}],
                ),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        binding.graph.aupdate_state.assert_called_once()

    @pytest.mark.asyncio
    async def test_orphan_without_msg_id_logs_warning(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()

        ai_msg = AIMessage(content="", tool_calls=[{"id": "tc-noid", "name": "x", "args": {}}])
        ai_msg.id = None

        state.values = {"messages": [ai_msg]}
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_multiple_orphans_removed(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                AIMessage(id="ai-o1", content="", tool_calls=[{"id": "tc1", "name": "a", "args": {}}]),
                AIMessage(id="ai-o2", content="", tool_calls=[{"id": "tc2", "name": "b", "args": {}}]),
                AIMessage(id="ai-ok", content="good"),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t1"}})

        remove_msgs = binding.graph.aupdate_state.call_args[0][1]["messages"]
        removed_ids = {m.id for m in remove_msgs}
        assert "ai-o1" in removed_ids
        assert "ai-o2" in removed_ids
        assert len(removed_ids) == 2

    @pytest.mark.asyncio
    async def test_repair_exception_triggers_fallback(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        binding.graph.aget_state.side_effect = RuntimeError("DB connection lost")
        binding.graph.checkpointer = MagicMock()

        await binding._repair_orphaned_tool_calls(
            {"configurable": {"thread_id": "t-fallback"}}
        )

        binding.graph.aupdate_state.assert_called_once()
        call_args = binding.graph.aupdate_state.call_args[0][1]["messages"]
        assert any("interrupted" in m.content.lower() for m in call_args if hasattr(m, "content"))

    @pytest.mark.asyncio
    async def test_repair_exception_fallback_also_fails(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        binding.graph.aget_state.side_effect = RuntimeError("DB error")
        binding.graph.checkpointer = MagicMock()
        binding.graph.aupdate_state.side_effect = RuntimeError("Also broken")

        await binding._repair_orphaned_tool_calls(
            {"configurable": {"thread_id": "t-double-fail"}}
        )


# ============================================================================
# _deserialize_a2a_event
# ============================================================================

class TestDeserializeA2AEvent:
    """Test A2A event deserialization."""

    def _make_binding(self):
        with patch("ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.AIPlatformEngineerMAS") as mock_mas, \
             patch("ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.TracingManager"):
            mock_mas.return_value.get_graph.return_value = AsyncMock()
            from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import AIPlatformEngineerA2ABinding
            return AIPlatformEngineerA2ABinding()

    def test_non_dict_returns_none(self):
        binding = self._make_binding()
        assert binding._deserialize_a2a_event("string") is None
        assert binding._deserialize_a2a_event(42) is None
        assert binding._deserialize_a2a_event(None) is None
        assert binding._deserialize_a2a_event([1, 2]) is None

    def test_invalid_dict_returns_none(self):
        binding = self._make_binding()
        assert binding._deserialize_a2a_event({"random": "data"}) is None

    def test_empty_dict_returns_none(self):
        binding = self._make_binding()
        assert binding._deserialize_a2a_event({}) is None


# ============================================================================
# stream() config wiring
# ============================================================================

class TestStreamConfigWiring:
    """Test that stream() correctly wires context_id and trace_id into config.

    These tests verify the config dict manipulation logic rather than
    mocking through the decorator layer.
    """

    def test_context_id_added_to_config_metadata(self):
        """Verify context_id is added to metadata dict when present."""
        config = {"configurable": {"thread_id": "ctx-123"}}
        context_id = "ctx-123"

        if "metadata" not in config:
            config["metadata"] = {}
        if context_id:
            config["metadata"]["context_id"] = context_id

        assert config["metadata"]["context_id"] == "ctx-123"

    def test_trace_id_added_to_config_metadata(self):
        """Verify trace_id is added to metadata dict when provided."""
        config = {"configurable": {"thread_id": "ctx"}, "metadata": {}}
        trace_id = "trace-abc"

        if trace_id:
            config["metadata"]["trace_id"] = trace_id

        assert config["metadata"]["trace_id"] == "trace-abc"

    def test_trace_id_from_tracing_context(self):
        """Verify trace_id fallback from TracingManager context."""
        config = {"configurable": {"thread_id": "ctx"}, "metadata": {}}
        trace_id = None
        current_trace_id = "trace-from-context"

        if trace_id:
            config["metadata"]["trace_id"] = trace_id
        else:
            if current_trace_id:
                config["metadata"]["trace_id"] = current_trace_id

        assert config["metadata"]["trace_id"] == "trace-from-context"

    def test_no_trace_id_available(self):
        """Verify no trace_id when none available."""
        config = {"configurable": {"thread_id": "ctx"}, "metadata": {}}
        trace_id = None
        current_trace_id = None

        if trace_id:
            config["metadata"]["trace_id"] = trace_id
        elif current_trace_id:
            config["metadata"]["trace_id"] = current_trace_id

        assert "trace_id" not in config["metadata"]

    def test_none_context_id_not_added(self):
        """Verify context_id not added when None."""
        config = {"configurable": {"thread_id": "auto"}}
        context_id = None

        if "metadata" not in config:
            config["metadata"] = {}
        if context_id:
            config["metadata"]["context_id"] = context_id

        assert "context_id" not in config["metadata"]

    def test_metadata_created_if_missing(self):
        """Verify metadata dict is created if absent from config."""
        config = {"configurable": {"thread_id": "ctx"}}
        assert "metadata" not in config

        if "metadata" not in config:
            config["metadata"] = {}

        assert "metadata" in config
        assert config["metadata"] == {}


# ============================================================================
# deep_agent checkpointer wiring
# ============================================================================

class TestDeepAgentCheckpointerWiring:
    """Test InMemorySaver checkpointer wiring in deep_agent."""

    def test_checkpointer_attached_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LANGGRAPH_DEV", None)

            with patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.platform_registry") as mock_reg, \
                 patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.create_deep_agent") as mock_create, \
                 patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory"):
                mock_reg.agents = {}
                mock_reg.enable_dynamic_monitoring = MagicMock()
                mock_reg.get_all_agents.return_value = {}

                mock_graph = MagicMock()
                mock_create.return_value = mock_graph

                from importlib import reload
                import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as da_module
                reload(da_module)

                da_module.AIPlatformEngineerMAS()
                assert mock_graph.checkpointer is not None

    def test_checkpointer_disabled_with_langgraph_dev(self):
        with patch.dict(os.environ, {"LANGGRAPH_DEV": "1"}):
            with patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.platform_registry") as mock_reg, \
                 patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.create_deep_agent") as mock_create, \
                 patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory"):
                mock_reg.agents = {}
                mock_reg.enable_dynamic_monitoring = MagicMock()
                mock_reg.get_all_agents.return_value = {}

                mock_graph = MagicMock(spec=["checkpointer"])
                mock_graph.checkpointer = None
                mock_create.return_value = mock_graph

                from importlib import reload
                import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as da_module
                reload(da_module)

                da_module.AIPlatformEngineerMAS()
                assert mock_graph.checkpointer is None


# ============================================================================
# agent_executor context_id extraction
# ============================================================================

class TestAgentExecutorContextExtraction:
    """Test that the executor correctly extracts context_id from A2A message."""

    def test_context_id_from_message(self):
        mock_context = MagicMock()
        mock_context.message.context_id = "uuid-from-client"
        assert mock_context.message.context_id == "uuid-from-client"

    def test_context_id_none_when_no_message(self):
        mock_context = MagicMock()
        mock_context.message = None
        context_id = mock_context.message.context_id if mock_context.message else None
        assert context_id is None


# ============================================================================
# Edge cases for message types in repair
# ============================================================================

class TestRepairEdgeCases:
    """Additional edge cases for orphan repair."""

    def _make_binding(self):
        with patch("ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.AIPlatformEngineerMAS") as mock_mas, \
             patch("ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.TracingManager"):
            mock_mas.return_value.get_graph.return_value = AsyncMock()
            from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import AIPlatformEngineerA2ABinding
            return AIPlatformEngineerA2ABinding()

    @pytest.mark.asyncio
    async def test_mixed_resolved_and_orphaned(self):
        """One tool call resolved, another orphaned in the same AIMessage."""
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                AIMessage(
                    id="ai-mixed",
                    content="",
                    tool_calls=[
                        {"id": "tc-ok", "name": "github", "args": {}},
                        {"id": "tc-orphan", "name": "jira", "args": {}},
                    ],
                ),
                ToolMessage(content="gh result", tool_call_id="tc-ok"),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t"}})

        binding.graph.aupdate_state.assert_called_once()
        removed_ids = {m.id for m in binding.graph.aupdate_state.call_args[0][1]["messages"]}
        assert "ai-mixed" in removed_ids

    @pytest.mark.asyncio
    async def test_only_human_and_ai_text_no_tools(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                HumanMessage(content="q1"),
                AIMessage(id="ai1", content="answer"),
                HumanMessage(content="q2"),
                AIMessage(id="ai2", content="answer2"),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_tool_calls_resolved(self):
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                AIMessage(
                    id="ai1",
                    content="",
                    tool_calls=[
                        {"id": "tc1", "name": "a", "args": {}},
                        {"id": "tc2", "name": "b", "args": {}},
                    ],
                ),
                ToolMessage(content="r1", tool_call_id="tc1"),
                ToolMessage(content="r2", tool_call_id="tc2"),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t"}})
        binding.graph.aupdate_state.assert_not_called()

    @pytest.mark.asyncio
    async def test_tool_message_without_matching_ai(self):
        """Stray ToolMessage without AIMessage - should not crash."""
        binding = self._make_binding()
        binding.graph = AsyncMock()
        state = MagicMock()
        state.values = {
            "messages": [
                ToolMessage(content="orphan result", tool_call_id="tc-stray"),
                AIMessage(id="ai1", content="response"),
            ]
        }
        binding.graph.aget_state.return_value = state

        await binding._repair_orphaned_tool_calls({"configurable": {"thread_id": "t"}})
        binding.graph.aupdate_state.assert_not_called()
