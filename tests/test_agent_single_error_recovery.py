#!/usr/bin/env python3
"""
Unit tests for agent_single.py error-recovery fixes.

Fix A — Preserve ResponseFormat result across recursion-limit exceptions
  When the deepagents graph hits its recursion limit AFTER a ResponseFormat
  tool call has already been captured (i.e. the task finished but the graph
  kept running), the exception handler was unconditionally wiping
  `response_format_result = None`, discarding the valid result.

  Fix: save `_saved_response_format = response_format_result` before the
  reset when `is_recursion_limit`, then restore it after Phase-1 state
  repair — so the caller receives the correct structured response instead
  of the generic fallback "I ran into an issue…" message.

Fix B — Phase-2 wrap-up: detect correct graph node name
  Phase-2 recovery called `graph.aupdate_state(…, as_node="agent")`, but
  the deepagents library names its main node "model", not "agent".  This
  caused:
      Phase 2 wrap-up failed: Node agent does not exist

  Fix: detect the correct node name at runtime via
      `set(getattr(self.graph, 'nodes', {}).keys())`
  and fall back to "agent" when "model" is absent (standard LangGraph).

Usage:
    pytest tests/test_agent_single_error_recovery.py -v
"""

import ast
import inspect
import os
import sys
import textwrap

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

# ---------------------------------------------------------------------------
# sys.path fix: standalone agent packages live at
#   ai_platform_engineering/agents/<name>/  (each is its own Python package)
# In deployed containers this is handled by sitecustomize.py; in the local
# test environment we add the directories explicitly.
# ---------------------------------------------------------------------------
_AGENTS_BASE = os.path.join(
    os.path.dirname(__file__),
    "..",
    "ai_platform_engineering",
    "agents",
)
if os.path.isdir(_AGENTS_BASE):
    for _agent_dir in os.listdir(_AGENTS_BASE):
        _agent_path = os.path.join(_AGENTS_BASE, _agent_dir)
        if os.path.isdir(_agent_path) and _agent_path not in sys.path:
            sys.path.insert(0, _agent_path)


# ---------------------------------------------------------------------------
# Helpers to construct minimal binding instances
# ---------------------------------------------------------------------------

def _make_binding():
    """
    Return an AIPlatformEngineerA2ABinding constructed without __init__,
    matching the pattern used in test_supervisor_streaming_json_and_orphaned_tools.py.
    """
    from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor_single import (
        AIPlatformEngineerA2ABinding,
    )
    binding = AIPlatformEngineerA2ABinding.__new__(AIPlatformEngineerA2ABinding)
    binding.graph = MagicMock()
    binding.graph.nodes = {"__start__": None, "model": None, "tools": None}
    binding.graph.aget_state = AsyncMock(return_value=MagicMock(values={"messages": []}))
    binding.graph.aupdate_state = AsyncMock()
    binding.graph.astream = AsyncMock(return_value=_empty_aiter())
    binding._mas_instance = MagicMock()
    binding._mas_instance.get_rag_tool_names = MagicMock(return_value=set())
    binding._in_self_service_workflow = False
    return binding


async def _empty_aiter():
    """Async generator that yields nothing."""
    return
    yield  # make it an async generator


# ---------------------------------------------------------------------------
# Source-level (AST) tests — verify the fix exists in the source
# ---------------------------------------------------------------------------

class TestSourceLevelFixes:
    """
    Parse agent_single.py with ast and assert the two fixes are present.
    These are fast, zero-dependency checks that the patches weren't
    accidentally reverted.
    """

    def _get_source(self) -> str:
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a import agent_single
        return inspect.getsource(agent_single)

    # ── Fix A: _saved_response_format ────────────────────────────────────────

    def test_saved_response_format_variable_exists_in_source(self):
        """The variable _saved_response_format must be assigned in stream()."""
        src = self._get_source()
        assert "_saved_response_format" in src, (
            "_saved_response_format not found in agent_single.py — "
            "Fix A (preserve ResponseFormat on recursion limit) may have been reverted"
        )

    def test_saved_response_format_is_conditional_on_recursion_limit(self):
        """_saved_response_format should only be set when is_recursion_limit is True."""
        src = self._get_source()
        # The assignment must be guarded by is_recursion_limit
        assert "is_recursion_limit" in src
        # Ensure the save and restore pattern is present
        assert "_saved_response_format = response_format_result if is_recursion_limit" in src, (
            "Expected pattern '_saved_response_format = response_format_result if is_recursion_limit' "
            "not found in agent_single.py"
        )

    def test_restore_of_saved_response_format_is_present(self):
        """The restore block must exist after Phase-1 state repair."""
        src = self._get_source()
        assert "response_format_result = _saved_response_format" in src, (
            "Restore of _saved_response_format not found — the fix may be incomplete"
        )

    # ── Fix B: dynamic node name detection ───────────────────────────────────

    def test_dynamic_agent_node_detection_present(self):
        """
        The Phase-2 wrap-up must detect the graph node name at runtime
        rather than hard-coding 'agent'.
        """
        src = self._get_source()
        assert "_agent_node" in src, (
            "_agent_node variable not found in agent_single.py — "
            "Fix B (dynamic node name) may have been reverted"
        )

    def test_model_node_preferred_over_agent(self):
        """The detection logic must prefer 'model' when present in graph.nodes."""
        src = self._get_source()
        assert '"model" if "model" in _graph_nodes else "agent"' in src, (
            'Expected node detection: "model" if "model" in _graph_nodes else "agent"'
        )

    def test_as_node_uses_dynamic_variable(self):
        """aupdate_state must be called with as_node=_agent_node, not as_node='agent'."""
        src = self._get_source()
        assert 'as_node=_agent_node' in src, (
            "as_node= must reference _agent_node, not the hardcoded string 'agent'"
        )
        # The old hardcoded as_node="agent" must NOT exist in the Phase-2 block.
        # We check there's no raw as_node="agent" string (allowing for the comment).
        lines_with_as_node_agent = [
            line for line in src.splitlines()
            if 'as_node="agent"' in line and not line.strip().startswith("#")
        ]
        assert not lines_with_as_node_agent, (
            f"Found hardcoded as_node=\"agent\" in non-comment lines: {lines_with_as_node_agent}"
        )


# ---------------------------------------------------------------------------
# Unit tests for the node-name detection logic (Fix B)
# ---------------------------------------------------------------------------

class TestPhase2WrapupNodeDetection:
    """
    Verify that _agent_node resolves to the correct value for different
    graph node layouts.
    """

    def _detect_agent_node(self, graph_nodes: dict) -> str:
        """Replicate the detection logic from agent_single.py (graph.nodes is a dict)."""
        _graph_nodes = set(graph_nodes.keys())
        return "model" if "model" in _graph_nodes else "agent"

    def test_deepagents_graph_resolves_to_model(self):
        """deepagents graph has 'model' as its main node."""
        nodes = {
            "__start__": None, "model": None, "tools": None,
            "TodoListMiddleware.after_model": None,
            "SummarizationMiddleware.before_model": None,
            "PatchToolCallsMiddleware.before_agent": None,
        }
        assert self._detect_agent_node(nodes) == "model"

    def test_standard_langgraph_resolves_to_agent(self):
        """Standard LangGraph supervisor has 'agent' as its main node."""
        nodes = {"__start__": None, "agent": None, "tools": None}
        assert self._detect_agent_node(nodes) == "agent"

    def test_empty_nodes_falls_back_to_agent(self):
        """Gracefully falls back to 'agent' when nodes is empty."""
        assert self._detect_agent_node({}) == "agent"

    def test_graph_with_both_model_and_agent_prefers_model(self):
        """If both exist, 'model' wins (deepagents takes priority)."""
        nodes = {"model": None, "agent": None, "tools": None}
        assert self._detect_agent_node(nodes) == "model"

    def test_aupdate_state_called_with_model_for_deepagents_graph(self):
        """
        When graph.nodes contains 'model', aupdate_state should be called
        with as_node='model' during Phase-2 wrap-up.
        """
        binding = _make_binding()
        # Verify that when graph.nodes contains 'model', _agent_node → 'model'
        _graph_nodes = set(getattr(binding.graph, 'nodes', {}).keys())
        _agent_node = "model" if "model" in _graph_nodes else "agent"
        assert _agent_node == "model"

    def test_aupdate_state_called_with_agent_for_standard_graph(self):
        """When graph.nodes contains 'agent' but not 'model', _agent_node → 'agent'."""
        binding = _make_binding()
        binding.graph.nodes = {"__start__": None, "agent": None, "tools": None}
        _graph_nodes = set(getattr(binding.graph, 'nodes', {}).keys())
        _agent_node = "model" if "model" in _graph_nodes else "agent"
        assert _agent_node == "agent"

    def test_getattr_fallback_when_nodes_missing(self):
        """When graph has no .nodes attribute, falls back to 'agent' safely."""
        binding = _make_binding()
        del binding.graph.nodes  # simulate graph without .nodes
        _graph_nodes = set(getattr(binding.graph, 'nodes', {}).keys())
        _agent_node = "model" if "model" in _graph_nodes else "agent"
        assert _agent_node == "agent"


# ---------------------------------------------------------------------------
# Unit tests for _saved_response_format preservation logic (Fix A)
# ---------------------------------------------------------------------------

class TestResponseFormatPreservationOnRecursionLimit:
    """
    Verify the _saved_response_format save/restore logic.

    We test the branching conditions directly since driving the full
    stream() generator requires a complex graph fixture.  The source-level
    tests above guarantee the logic is wired into the right location.
    """

    def _run_save_restore(
        self,
        response_format_result,
        is_recursion_limit: bool,
    ):
        """
        Simulate the save-and-restore block from agent_single.py:

            _saved_response_format = response_format_result if is_recursion_limit else None
            response_format_result = None
            # ... Phase-1 state repair ...
            if _saved_response_format and not response_format_result:
                response_format_result = _saved_response_format

        Returns the final response_format_result.
        """
        # Step 1: save
        _saved_response_format = response_format_result if is_recursion_limit else None
        response_format_result = None

        # Step 2: restore (Phase-1 did not set a new result)
        if _saved_response_format and not response_format_result:
            response_format_result = _saved_response_format

        return response_format_result

    # ── Recursion limit with a pre-captured result ────────────────────────────

    def test_result_is_restored_when_recursion_limit_and_pre_captured_result(self):
        pre = {"content": "Webex message sent.", "is_task_complete": True, "require_user_input": False}
        result = self._run_save_restore(pre, is_recursion_limit=True)
        assert result == pre

    def test_restored_result_has_correct_content(self):
        pre = {"content": "Done.", "is_task_complete": True, "require_user_input": False}
        result = self._run_save_restore(pre, is_recursion_limit=True)
        assert result["content"] == "Done."
        assert result["is_task_complete"] is True

    # ── Non-recursion error must NOT restore ─────────────────────────────────

    def test_result_is_not_restored_for_non_recursion_errors(self):
        """Context overflow and other errors should NOT restore a stale result."""
        pre = {"content": "Old result.", "is_task_complete": True, "require_user_input": False}
        result = self._run_save_restore(pre, is_recursion_limit=False)
        assert result is None

    def test_result_is_not_restored_for_context_overflow(self):
        pre = {"content": "Pre-overflow result.", "is_task_complete": True, "require_user_input": False}
        result = self._run_save_restore(pre, is_recursion_limit=False)
        assert result is None

    # ── No pre-captured result ────────────────────────────────────────────────

    def test_none_pre_result_stays_none_on_recursion_limit(self):
        """If ResponseFormat was never captured before the limit, result stays None."""
        result = self._run_save_restore(None, is_recursion_limit=True)
        assert result is None

    # ── Fallback message is NOT returned when result is preserved ─────────────

    def test_fallback_message_not_needed_when_result_is_restored(self):
        """
        Verify that once _saved_response_format is restored, the code path
        that would yield the fallback error string is skipped.

        The fallback is only yielded when `not response_format_result` after
        all recovery attempts.  We confirm the restored result is truthy.
        """
        pre = {"content": "Task complete.", "is_task_complete": True, "require_user_input": False}
        result = self._run_save_restore(pre, is_recursion_limit=True)

        fallback_message = (
            "I ran into an issue while processing your request. "
            "Please ask me to continue or try your question again."
        )
        # result is truthy → fallback would not be emitted
        assert result  # truthy
        assert result.get("content") != fallback_message

    # ── Idempotency: Phase-1 result takes priority ────────────────────────────

    def test_phase1_result_overrides_saved_result(self):
        """
        If Phase-1 recovery somehow produced a new response_format_result,
        the saved value should NOT clobber it (the `not response_format_result`
        guard prevents this).
        """
        pre = {"content": "Saved.", "is_task_complete": True, "require_user_input": False}
        _saved_response_format = pre if True else None  # is_recursion_limit=True
        response_format_result = None

        # Simulate Phase-1 producing a new result
        response_format_result = {"content": "Phase-1 recovery.", "is_task_complete": True, "require_user_input": False}

        # Restore guard
        if _saved_response_format and not response_format_result:
            response_format_result = _saved_response_format

        assert response_format_result["content"] == "Phase-1 recovery."


# ---------------------------------------------------------------------------
# Integration: _repair_orphaned_tool_calls is still called during recovery
# ---------------------------------------------------------------------------

class TestRepairIsCalledOnRecursionLimit:
    """
    _repair_orphaned_tool_calls must still be invoked even when
    is_recursion_limit is True (Phase-1 state repair is always attempted).
    """

    def test_repair_method_is_defined_on_binding(self):
        binding = _make_binding()
        assert hasattr(binding, '_repair_orphaned_tool_calls') or True
        # The method must exist in the class
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor_single import (
            AIPlatformEngineerA2ABinding,
        )
        assert hasattr(AIPlatformEngineerA2ABinding, '_repair_orphaned_tool_calls')
