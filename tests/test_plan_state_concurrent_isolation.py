# assisted-by claude code claude-opus-4-6
"""
Concurrent session isolation tests for PlanState.

Verifies that two concurrent stream() calls on the singleton
AIPlatformEngineerA2ABinding do NOT leak execution plan state
between sessions. This is the end-to-end regression test for the
cross-session plan contamination bug.

Usage:
    pytest tests/test_plan_state_concurrent_isolation.py -v
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    PlanState,
    AIPlatformEngineerA2ABinding,
)


def _make_binding():
    """Create a minimal binding bypassing __init__ (no MAS/LLM needed)."""
    obj = object.__new__(AIPlatformEngineerA2ABinding)
    obj.graph = MagicMock()
    obj.tracing = MagicMock()
    obj.tracing.create_config.return_value = {
        "configurable": {"thread_id": "test"},
        "metadata": {},
    }
    obj.tracing.get_trace_id.return_value = None
    obj._initialized = True
    obj._mas_instance = MagicMock()
    obj._mas_instance._skills_files = None
    obj.SYSTEM_INSTRUCTION = "test"
    return obj


def _make_updates_event(tool_calls):
    """Build a (path, 'updates', event) tuple that stream() parses for task plan entries.

    tool_calls: list of dicts with keys: id, subagent_type, description
    """
    ai_msg = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "task",
                "id": tc["id"],
                "args": {
                    "subagent_type": tc["subagent_type"],
                    "description": tc["description"],
                },
            }
            for tc in tool_calls
        ],
    )
    return ((), "updates", {"agent": {"messages": [ai_msg]}})


def _make_final_event():
    """Build a (path, 'messages', event) tuple for a final AI message with [FINAL ANSWER]."""
    ai_msg = AIMessage(content="[FINAL ANSWER]\nDone.")
    return ((), "messages", (ai_msg, {}))


def _make_done_event():
    """Build a (path, 'updates', event) with empty dict to signal completion."""
    return ((), "updates", {})


class TestConcurrentStreamIsolation:
    """Two concurrent stream() calls on the same binding must not leak plan state."""

    @pytest.mark.asyncio
    async def test_concurrent_streams_have_independent_plans(self):
        """Session A's github/jira plan must not appear in Session B's argocd/pagerduty plan."""
        binding = _make_binding()

        # Synchronisation barriers so both sessions overlap
        session_a_started = asyncio.Event()
        session_b_started = asyncio.Event()

        # Collected artifacts from each session
        session_a_artifacts = []
        session_b_artifacts = []

        async def mock_astream_session_a(*args, **kwargs):
            """Session A: delegates to github and jira sub-agents."""
            session_a_started.set()
            await asyncio.wait_for(session_b_started.wait(), timeout=5)
            # Yield tool calls for github + jira
            yield _make_updates_event([
                {"id": "tc-a1", "subagent_type": "github", "description": "Fetch open PRs"},
                {"id": "tc-a2", "subagent_type": "jira", "description": "Search for incidents"},
            ])
            # Small yield to let event loop switch to session B
            await asyncio.sleep(0.01)
            yield _make_done_event()

        async def mock_astream_session_b(*args, **kwargs):
            """Session B: delegates to argocd and pagerduty sub-agents."""
            session_b_started.set()
            await asyncio.wait_for(session_a_started.wait(), timeout=5)
            # Yield tool calls for argocd + pagerduty
            yield _make_updates_event([
                {"id": "tc-b1", "subagent_type": "argocd", "description": "Check app sync status"},
                {"id": "tc-b2", "subagent_type": "pagerduty", "description": "Get oncall schedule"},
            ])
            await asyncio.sleep(0.01)
            yield _make_done_event()

        # Track which mock to use per call
        call_count = 0

        def astream_router(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_astream_session_a(*args, **kwargs)
            else:
                return mock_astream_session_b(*args, **kwargs)

        binding.graph.astream = astream_router

        # Patch away preflight/repair which need real graph state
        with patch.object(binding, '_repair_orphaned_tool_calls', new_callable=AsyncMock):
            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.preflight_context_check', new_callable=AsyncMock) as mock_preflight:
                mock_preflight.return_value = MagicMock(compressed=False, needs_compression=False)
                with patch('ai_platform_engineering.multi_agents.platform_engineer.rag_tools.clear_rag_state'):

                    async def collect_session_a():
                        async for event in binding.stream("list PRs and incidents", "ctx-a", "trace-a"):
                            if "artifact" in event:
                                session_a_artifacts.append(event["artifact"])

                    async def collect_session_b():
                        async for event in binding.stream("check argocd and oncall", "ctx-b", "trace-b"):
                            if "artifact" in event:
                                session_b_artifacts.append(event["artifact"])

                    # Run both sessions concurrently on the SAME binding
                    await asyncio.gather(collect_session_a(), collect_session_b())

        # Session A must only contain its own plan entries
        assert len(session_a_artifacts) >= 1, "Session A should have emitted a plan artifact"
        a_plan_text = session_a_artifacts[0]["text"]
        assert "Github" in a_plan_text, f"Session A plan should mention Github: {a_plan_text}"
        assert "Jira" in a_plan_text, f"Session A plan should mention Jira: {a_plan_text}"
        assert "Argocd" not in a_plan_text, f"Session A plan must NOT contain Session B's Argocd: {a_plan_text}"
        assert "Pagerduty" not in a_plan_text, f"Session A plan must NOT contain Session B's Pagerduty: {a_plan_text}"

        # Session B must only contain its own plan entries
        assert len(session_b_artifacts) >= 1, "Session B should have emitted a plan artifact"
        b_plan_text = session_b_artifacts[0]["text"]
        assert "Argocd" in b_plan_text, f"Session B plan should mention Argocd: {b_plan_text}"
        assert "Pagerduty" in b_plan_text, f"Session B plan should mention Pagerduty: {b_plan_text}"
        assert "Github" not in b_plan_text, f"Session B plan must NOT contain Session A's Github: {b_plan_text}"
        assert "Jira" not in b_plan_text, f"Session B plan must NOT contain Session A's Jira: {b_plan_text}"

    @pytest.mark.asyncio
    async def test_execution_plan_sent_flag_independent(self):
        """Session A setting execution_plan_sent must not affect Session B's first artifact name."""
        binding = _make_binding()

        session_a_ready = asyncio.Event()
        session_b_ready = asyncio.Event()

        session_a_artifacts = []
        session_b_artifacts = []

        async def mock_astream_a(*args, **kwargs):
            # Session A emits plan first
            yield _make_updates_event([
                {"id": "tc-a1", "subagent_type": "github", "description": "Fetch PRs"},
            ])
            session_a_ready.set()
            # Wait for B to start so both are overlapping
            await asyncio.wait_for(session_b_ready.wait(), timeout=5)
            yield _make_done_event()

        async def mock_astream_b(*args, **kwargs):
            # Wait for A to emit its plan first (so A's flag would be set if shared)
            await asyncio.wait_for(session_a_ready.wait(), timeout=5)
            session_b_ready.set()
            yield _make_updates_event([
                {"id": "tc-b1", "subagent_type": "argocd", "description": "Sync apps"},
            ])
            yield _make_done_event()

        call_count = 0

        def astream_router(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_astream_a(*args, **kwargs)
            else:
                return mock_astream_b(*args, **kwargs)

        binding.graph.astream = astream_router

        with patch.object(binding, '_repair_orphaned_tool_calls', new_callable=AsyncMock):
            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.preflight_context_check', new_callable=AsyncMock) as mock_preflight:
                mock_preflight.return_value = MagicMock(compressed=False, needs_compression=False)
                with patch('ai_platform_engineering.multi_agents.platform_engineer.rag_tools.clear_rag_state'):

                    async def collect_a():
                        async for event in binding.stream("fetch PRs", "ctx-a", "trace-a"):
                            if "artifact" in event:
                                session_a_artifacts.append(event)

                    async def collect_b():
                        async for event in binding.stream("sync apps", "ctx-b", "trace-b"):
                            if "artifact" in event:
                                session_b_artifacts.append(event)

                    await asyncio.gather(collect_a(), collect_b())

        # Both sessions should emit "execution_plan_update" as their FIRST artifact
        # (not "execution_plan_status_update"), because each has its own plan.execution_plan_sent
        assert session_a_artifacts[0]["artifact"]["name"] == "execution_plan_update", \
            "Session A's first plan should be 'execution_plan_update'"
        assert session_b_artifacts[0]["artifact"]["name"] == "execution_plan_update", \
            "Session B's first plan should be 'execution_plan_update' (not status_update), " \
            "proving execution_plan_sent is independent"

    @pytest.mark.asyncio
    async def test_sequential_streams_dont_carry_over_state(self):
        """Two sequential stream() calls must each start with a fresh PlanState."""
        binding = _make_binding()

        async def mock_astream_first(*args, **kwargs):
            yield _make_updates_event([
                {"id": "tc-1", "subagent_type": "github", "description": "First session task"},
            ])
            yield _make_done_event()

        async def mock_astream_second(*args, **kwargs):
            yield _make_updates_event([
                {"id": "tc-2", "subagent_type": "jira", "description": "Second session task"},
            ])
            yield _make_done_event()

        with patch.object(binding, '_repair_orphaned_tool_calls', new_callable=AsyncMock):
            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.preflight_context_check', new_callable=AsyncMock) as mock_preflight:
                mock_preflight.return_value = MagicMock(compressed=False, needs_compression=False)
                with patch('ai_platform_engineering.multi_agents.platform_engineer.rag_tools.clear_rag_state'):

                    # First stream
                    binding.graph.astream = lambda *a, **kw: mock_astream_first(*a, **kw)
                    first_artifacts = []
                    async for event in binding.stream("first query", "ctx-1", "trace-1"):
                        if "artifact" in event:
                            first_artifacts.append(event["artifact"])

                    # Second stream
                    binding.graph.astream = lambda *a, **kw: mock_astream_second(*a, **kw)
                    second_artifacts = []
                    async for event in binding.stream("second query", "ctx-2", "trace-2"):
                        if "artifact" in event:
                            second_artifacts.append(event["artifact"])

        # First session: only github
        assert len(first_artifacts) >= 1
        assert "Github" in first_artifacts[0]["text"]
        assert "Jira" not in first_artifacts[0]["text"]

        # Second session: only jira, no carry-over from first
        assert len(second_artifacts) >= 1
        assert "Jira" in second_artifacts[0]["text"]
        assert "Github" not in second_artifacts[0]["text"]

        # Both should be "execution_plan_update" (not status_update)
        assert first_artifacts[0]["name"] == "execution_plan_update"
        assert second_artifacts[0]["name"] == "execution_plan_update"
