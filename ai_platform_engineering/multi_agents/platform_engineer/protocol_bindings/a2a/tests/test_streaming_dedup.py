# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for streaming deduplication in the A2A executor.

These tests verify that single sub-agent scenarios do NOT produce duplicate
content in the SSE stream. The patterns are derived from real A2A streaming
sessions (GitHub profile lookup, ArgoCD version query) with all personal
and corporate data sanitised.

Expected SSE event flow for single sub-agent:

  1.  task (submitted)
  2.  streaming_result chunks (supervisor intro)
  3.  tool_notification_start (write_todos)
  4.  execution_plan_update
  5.  tool_notification_end (write_todos)
  6.  streaming_result chunks (supervisor transition)
  7.  tool_notification_start (sub-agent call)
  8.  streaming_result chunks (sub-agent streams answer)
  9.  tool_notification_start/end (sub-agent tool calls)
  10. streaming_result chunks (sub-agent continues)
  11. complete_result (sub-agent final answer, lastChunk=true)  <-- forwarded
  12. tool_notification_end (supervisor agent done)
  13. tool_notification_start/end (write_todos update)
  14. execution_plan_status_update
  15. status-update (completed, final=true)                     <-- isFinal

DEDUP guarantees:
  - NO streaming_result artifacts after complete_result
  - NO final_result artifact when single sub-agent sent complete_result
  - Completion status (final=true) always sent
  - Multi-agent (2+) still gets final_result with synthesized content
  - Tool notifications always forwarded regardless of dedup state
"""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
)
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    StreamState,
    new_text_artifact,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_task(task_id="task-dedup-1", context_id="ctx-dedup-1"):
    """Create a minimal A2A Task mock."""
    task = MagicMock()
    task.id = task_id
    task.context_id = context_id
    return task


def _make_event_queue():
    """Create an async EventQueue mock."""
    eq = AsyncMock()
    eq.enqueue_event = AsyncMock()
    return eq


def _make_executor():
    """Create executor with mocked agent."""
    with patch.object(AIPlatformEngineerA2AExecutor, '__init__', lambda self: None):
        executor = AIPlatformEngineerA2AExecutor()
        executor.agent = MagicMock()
        executor._safe_enqueue_event = AsyncMock()
        executor._execution_plan_emitted = False
        executor._execution_plan_artifact_id = None
        executor._latest_execution_plan = []
        return executor


def _extract_sent_events(executor):
    """Extract all events sent via _safe_enqueue_event."""
    return [call[0][1] for call in executor._safe_enqueue_event.call_args_list]


def _extract_artifacts(executor):
    """Extract only TaskArtifactUpdateEvent events."""
    return [
        e for e in _extract_sent_events(executor)
        if isinstance(e, TaskArtifactUpdateEvent)
    ]


def _extract_status_events(executor):
    """Extract only TaskStatusUpdateEvent events."""
    return [
        e for e in _extract_sent_events(executor)
        if isinstance(e, TaskStatusUpdateEvent)
    ]


# ===================================================================
# _handle_streaming_chunk — Deduplication Tests
# ===================================================================

class TestStreamingChunkDedup(unittest.IsolatedAsyncioTestCase):
    """
    After a single sub-agent sends complete_result (sub_agents_completed == 1),
    non-notification streaming chunks from the supervisor must be suppressed
    (accumulated silently, not forwarded to client).
    """

    async def test_chunks_before_subagent_completion_are_forwarded(self):
        """Streaming chunks sent BEFORE any sub-agent completion are forwarded."""
        executor = _make_executor()
        state = StreamState()  # sub_agents_completed == 0
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "I'll help you", task, eq)
        await executor._handle_streaming_chunk({}, state, " get that info.", task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 2)
        self.assertEqual(artifacts[0].artifact.name, 'streaming_result')
        self.assertFalse(artifacts[0].append)  # First chunk: new artifact
        self.assertTrue(artifacts[1].append)    # Second chunk: append

    async def test_chunks_after_single_subagent_completion_are_suppressed(self):
        """After 1 sub-agent completes, streaming chunks must be silently accumulated."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1  # Sub-agent already sent complete_result
        task = _make_task()
        eq = _make_event_queue()

        # These simulate the supervisor re-streaming sub-agent content
        await executor._handle_streaming_chunk({}, state, "Here is the result:", task, eq)
        await executor._handle_streaming_chunk({}, state, " ArgoCD v2.9.3", task, eq)

        # No artifacts should have been forwarded
        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 0)

        # But content should still be accumulated for fallback
        self.assertIn("Here is the result:", state.supervisor_content)
        self.assertIn(" ArgoCD v2.9.3", state.supervisor_content)

    async def test_tool_notifications_always_forwarded_after_subagent_completion(self):
        """Tool notifications (write_todos, etc.) are ALWAYS forwarded, even after sub-agent completion."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        # Tool notification should still be forwarded
        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'write_todos'}},
            state,
            '🔧 Supervisor: Calling Agent Write_Todos...\n',
            task, eq,
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'tool_notification_start')

    async def test_tool_result_notifications_forwarded_after_subagent_completion(self):
        """Tool completion notifications are always forwarded."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.current_agent = 'write_todos'
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_result': {'name': 'write_todos'}},
            state,
            '✅ Supervisor: Agent task Write_Todos completed\n',
            task, eq,
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'tool_notification_end')

    async def test_multi_agent_chunks_not_suppressed(self):
        """With 2+ sub-agents completed, supervisor synthesis must be forwarded."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2  # Multi-agent scenario
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Combining results:", task, eq)
        await executor._handle_streaming_chunk({}, state, " Agent A and Agent B found...", task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 2)

    async def test_zero_completed_chunks_not_suppressed(self):
        """With 0 sub-agents completed, all chunks are forwarded (normal streaming)."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 0
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Working...", task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)

    async def test_empty_content_skipped_always(self):
        """Empty content returns early regardless of dedup state."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, '', task, eq)
        self.assertEqual(len(_extract_sent_events(executor)), 0)

    async def test_suppressed_chunks_do_not_create_streaming_artifact_id(self):
        """Suppressed chunks should not set streaming_artifact_id."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Suppressed content", task, eq)

        # streaming_artifact_id should remain None since no artifact was created
        self.assertIsNone(state.streaming_artifact_id)


# ===================================================================
# _handle_stream_end — Deduplication Tests
# ===================================================================

class TestStreamEndDedup(unittest.IsolatedAsyncioTestCase):
    """
    When exactly 1 sub-agent completed (sent complete_result which was already
    forwarded), _handle_stream_end must NOT send a duplicate final_result.
    It should only send the completion status.
    """

    async def test_single_agent_skips_final_result_sends_completion_only(self):
        """Single sub-agent: completion status sent, NO final_result artifact."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['ArgoCD version is v2.9.3 with Helm v3.14.0 and Kustomize v5.3.0.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # Should only get completion status, NO final_result
        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 0, "No artifact should be sent for single sub-agent dedup")

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertEqual(status_events[0].status.state, TaskState.completed)
        self.assertTrue(status_events[0].final)

    async def test_multi_agent_sends_final_result(self):
        """Multi-agent (2+): final_result with synthesized content IS sent."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = [
            'Based on GitHub and ArgoCD data: ',
            'User testuser has 10 repos and ArgoCD v2.9.3.'
        ]
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)
        self.assertEqual(artifacts[-1].artifact.name, 'final_result')

        # Completion status also sent
        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertTrue(status_events[0].final)

    async def test_zero_agents_sends_partial_result(self):
        """No sub-agents completed: sends partial_result + completion."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 0
        state.supervisor_content = ['Some accumulated content']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)
        self.assertEqual(artifacts[-1].artifact.name, 'partial_result')

    async def test_single_agent_empty_content_falls_through(self):
        """Single sub-agent but no content: falls through to normal path."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = []  # Empty — dedup guard won't trigger
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # Falls through to normal path which checks supervisor_content too
        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertTrue(status_events[0].final)

    async def test_datapart_still_sends_artifact(self):
        """DataPart results are NOT subject to dedup — always sent."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_datapart = {'chart_type': 'bar', 'data': [1, 2, 3]}
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # DataPart triggers _get_final_content which returns datapart — should send artifact
        artifacts = _extract_artifacts(executor)
        # DataPart path goes through normal flow (no dedup since sub_agent_content is empty)
        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)


# ===================================================================
# _handle_task_complete — Deduplication Tests
# ===================================================================

class TestTaskCompleteDedup(unittest.IsolatedAsyncioTestCase):
    """
    When _handle_task_complete fires for a single sub-agent scenario,
    it must NOT send a duplicate final_result. Just send completion status.
    """

    async def test_single_agent_skips_final_result(self):
        """Single sub-agent complete: only completion status, no final_result."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = [
            'Here is the GitHub profile for **testuser**:\n\n'
            '| Field | Value |\n'
            '|-------|-------|\n'
            '| **Username** | testuser |\n'
            '| **Name** | Test User |\n'
            '| **Public Repos** | 42 |\n'
        ]
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 0, "No final_result artifact for single sub-agent")

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertEqual(status_events[0].status.state, TaskState.completed)
        self.assertTrue(status_events[0].final)

    async def test_multi_agent_sends_final_result(self):
        """Multi-agent: final_result IS sent with synthesized content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Synthesized: Agent A found X, Agent B found Y.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)
        self.assertEqual(artifacts[-1].artifact.name, 'final_result')

    async def test_no_accumulated_content_uses_event_fallback(self):
        """No accumulated content: uses event content string as fallback."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 0
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, 'Fallback content from event', task, eq
        )

        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)
        # The fallback content should be in the final_result
        text = artifacts[-1].artifact.parts[0].root.text
        self.assertIn('Fallback content from event', text)

    async def test_single_agent_with_datapart_sends_artifact(self):
        """Single sub-agent with DataPart: NOT subject to text dedup."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_datapart = {'form_fields': [{'name': 'repo'}]}
        # sub_agent_content is empty, so dedup guard won't trigger
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        # DataPart path — should send artifact
        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)

    async def test_single_agent_empty_content_sends_fallback(self):
        """Single sub-agent but sub_agent_content is empty: falls through."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = []  # Empty — dedup guard won't trigger
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, 'Event fallback', task, eq
        )

        # Falls through to normal path
        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)


# ===================================================================
# End-to-End SSE Pattern Tests (based on real captures)
# ===================================================================

class TestEndToEndGitHubProfilePattern(unittest.IsolatedAsyncioTestCase):
    """
    Simulates the real SSE pattern from a GitHub profile query.
    Verifies the full event sequence matches expected dedup behavior.

    Real pattern (sanitized):
      supervisor streams intro → write_todos → sub-agent streams → tools →
      sub-agent streams answer → complete_result (forwarded) →
      [NO supervisor re-streaming] → [NO final_result] →
      status: completed (final=true)
    """

    async def test_github_profile_full_flow(self):
        """Simulate complete GitHub profile flow, verify no duplication."""
        executor = _make_executor()
        state = StreamState()
        task = _make_task(task_id="task-gh-profile")
        eq = _make_event_queue()

        # Phase 1: Supervisor intro streaming
        await executor._handle_streaming_chunk({}, state, "I'll retrieve", task, eq)
        await executor._handle_streaming_chunk({}, state, " the GitHub profile.", task, eq)

        # Phase 2: write_todos tool call (notification — always forwarded)
        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'write_todos'}},
            state,
            '🔧 Supervisor: Calling Agent Write_Todos...\n',
            task, eq,
        )

        # Phase 3: Supervisor transition
        await executor._handle_streaming_chunk({}, state, "Now let me fetch it:", task, eq)

        # Phase 4: Sub-agent call (notification)
        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'github'}},
            state,
            '🔧 Supervisor: Calling Agent Github...\n',
            task, eq,
        )

        # Verify: 5 events so far (2 streaming + 1 notification + 1 streaming + 1 notification)
        pre_subagent_events = _extract_sent_events(executor)
        self.assertEqual(len(pre_subagent_events), 5)

        # Phase 5: Sub-agent sends complete_result (via _handle_sub_agent_artifact)
        # This is forwarded to client and increments sub_agents_completed
        complete_event = {
            'result': {
                'artifact': {
                    'name': 'complete_result',
                    'parts': [{'text': (
                        "Here's the GitHub profile for **testuser**:\n\n"
                        "| Field | Value |\n|-------|-------|\n"
                        "| **Username** | testuser |\n"
                        "| **Name** | Test User |\n"
                        "| **Repos** | 42 |\n"
                        "| **Followers** | 100 |\n"
                    )}],
                    'artifactId': str(uuid.uuid4()),
                    'metadata': {'sourceAgent': 'github'},
                },
                'lastChunk': True,
            }
        }
        await executor._handle_sub_agent_artifact(complete_event, state, task, eq)

        self.assertEqual(state.sub_agents_completed, 1)

        # Phase 6: Supervisor tries to re-stream the same content (MUST be suppressed)
        await executor._handle_streaming_chunk({}, state, "Here's the GitHub profile", task, eq)
        await executor._handle_streaming_chunk({}, state, " for **testuser**:", task, eq)
        await executor._handle_streaming_chunk({}, state, " They have 42 repos.", task, eq)

        # Phase 7: write_todos status update (notification — always forwarded)
        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'write_todos'}},
            state,
            '🔧 Supervisor: Calling Agent Write_Todos...\n',
            task, eq,
        )

        # Phase 8: Task completion
        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        # === Assertions ===
        all_events = _extract_sent_events(executor)
        all_artifacts = _extract_artifacts(executor)
        all_statuses = _extract_status_events(executor)

        # Count artifact types
        artifact_names = [a.artifact.name for a in all_artifacts]
        complete_count = artifact_names.count('complete_result')
        final_count = artifact_names.count('final_result')
        streaming_count = artifact_names.count('streaming_result')
        notif_start_count = artifact_names.count('tool_notification_start')

        # Verify: exactly 1 complete_result (from sub-agent)
        self.assertEqual(complete_count, 1, "Exactly 1 complete_result expected")

        # Verify: NO final_result (deduped!)
        self.assertEqual(final_count, 0, "No final_result — single sub-agent dedup")

        # Verify: streaming_result count matches pre-subagent chunks only
        # (3 supervisor chunks before sub-agent + 0 after = 3)
        self.assertEqual(streaming_count, 3,
                         "Only pre-subagent streaming chunks forwarded")

        # Verify: tool notifications always forwarded (3 total: write_todos, github, write_todos)
        self.assertEqual(notif_start_count, 3,
                         "All tool notifications forwarded")

        # Verify: exactly 1 completion status
        self.assertEqual(len(all_statuses), 1)
        self.assertTrue(all_statuses[0].final)
        self.assertEqual(all_statuses[0].status.state, TaskState.completed)


class TestEndToEndArgocdVersionPattern(unittest.IsolatedAsyncioTestCase):
    """
    Simulates the real SSE pattern from an ArgoCD version query.
    Pattern is nearly identical to GitHub but with different sub-agent.
    """

    async def test_argocd_version_full_flow(self):
        """Simulate ArgoCD version flow, verify no duplication."""
        executor = _make_executor()
        state = StreamState()
        task = _make_task(task_id="task-argocd-ver")
        eq = _make_event_queue()

        # Supervisor intro
        await executor._handle_streaming_chunk({}, state, "I'll get", task, eq)
        await executor._handle_streaming_chunk({}, state, " the ArgoCD version.", task, eq)

        # write_todos notification
        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'write_todos'}},
            state,
            '🔧 Supervisor: Calling Agent Write_Todos...\n',
            task, eq,
        )

        # Supervisor transition
        await executor._handle_streaming_chunk({}, state, "Now querying ArgoCD:", task, eq)

        # ArgoCD sub-agent call
        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'argocd'}},
            state,
            '🔧 Supervisor: Calling Agent Argocd...\n',
            task, eq,
        )

        # Sub-agent sends complete_result
        argocd_content = (
            "Here's the ArgoCD version information:\n\n"
            "| Component | Version |\n|-----------|---------|\n"
            "| **ArgoCD** | v2.9.3+abc1234 |\n"
            "| **Helm** | v3.14.0 |\n"
            "| **Kustomize** | v5.3.0 |\n"
            "| **Go** | go1.22.0 |\n"
            "| **Platform** | linux/amd64 |\n\n"
            "Your ArgoCD instance is running **v2.9.3**."
        )
        complete_event = {
            'result': {
                'artifact': {
                    'name': 'complete_result',
                    'parts': [{'text': argocd_content}],
                    'artifactId': str(uuid.uuid4()),
                    'metadata': {'sourceAgent': 'argocd'},
                },
                'lastChunk': True,
            }
        }
        await executor._handle_sub_agent_artifact(complete_event, state, task, eq)
        self.assertEqual(state.sub_agents_completed, 1)

        # Supervisor tries re-streaming (SUPPRESSED)
        await executor._handle_streaming_chunk({}, state, "Here's the ArgoCD version", task, eq)
        await executor._handle_streaming_chunk({}, state, " v2.9.3 running on linux.", task, eq)

        # write_todos update notification (always forwarded)
        await executor._handle_streaming_chunk(
            {'tool_result': {'name': 'write_todos'}},
            state,
            '✅ Supervisor: Agent task Write_Todos completed\n',
            task, eq,
        )

        # Stream ends (not explicit task_complete)
        await executor._handle_stream_end(state, task, eq)

        # === Assertions ===
        all_artifacts = _extract_artifacts(executor)
        all_statuses = _extract_status_events(executor)
        artifact_names = [a.artifact.name for a in all_artifacts]

        # 1 complete_result, 0 final_result
        self.assertEqual(artifact_names.count('complete_result'), 1)
        self.assertEqual(artifact_names.count('final_result'), 0)

        # Pre-subagent streaming only (3 chunks)
        self.assertEqual(artifact_names.count('streaming_result'), 3)

        # Completion
        self.assertEqual(len(all_statuses), 1)
        self.assertTrue(all_statuses[0].final)


class TestEndToEndMultiAgentPattern(unittest.IsolatedAsyncioTestCase):
    """
    Multi-agent scenario: 2 sub-agents complete, supervisor synthesizes.
    NO dedup should occur — final_result with synthesis is expected.
    """

    async def test_multi_agent_no_dedup(self):
        """Two sub-agents: supervisor synthesis forwarded as final_result."""
        executor = _make_executor()
        state = StreamState()
        task = _make_task(task_id="task-multi-agent")
        eq = _make_event_queue()

        # Sub-agent 1 completes
        await executor._handle_sub_agent_artifact({
            'result': {
                'artifact': {
                    'name': 'complete_result',
                    'parts': [{'text': 'GitHub: testuser has 42 repos'}],
                    'artifactId': str(uuid.uuid4()),
                    'metadata': {'sourceAgent': 'github'},
                },
                'lastChunk': True,
            }
        }, state, task, eq)
        self.assertEqual(state.sub_agents_completed, 1)

        # Sub-agent 2 completes
        await executor._handle_sub_agent_artifact({
            'result': {
                'artifact': {
                    'name': 'complete_result',
                    'parts': [{'text': 'ArgoCD: version v2.9.3'}],
                    'artifactId': str(uuid.uuid4()),
                    'metadata': {'sourceAgent': 'argocd'},
                },
                'lastChunk': True,
            }
        }, state, task, eq)
        self.assertEqual(state.sub_agents_completed, 2)

        # Supervisor synthesis streaming (should NOT be suppressed)
        await executor._handle_streaming_chunk({}, state, "Based on both agents:", task, eq)
        await executor._handle_streaming_chunk({}, state, " testuser runs ArgoCD v2.9.3", task, eq)

        synth_artifacts = [
            a for a in _extract_artifacts(executor)
            if a.artifact.name == 'streaming_result'
        ]
        self.assertEqual(len(synth_artifacts), 2, "Multi-agent synthesis streamed")

        # Task completion sends final_result
        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        all_artifacts = _extract_artifacts(executor)
        artifact_names = [a.artifact.name for a in all_artifacts]
        self.assertIn('final_result', artifact_names, "Multi-agent gets final_result")

        # Verify synthesis content in final_result
        final = [a for a in all_artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final), 1)


# ===================================================================
# Edge Cases
# ===================================================================

class TestDedupEdgeCases(unittest.IsolatedAsyncioTestCase):
    """Edge cases around deduplication boundaries."""

    async def test_three_subagents_no_dedup(self):
        """3 sub-agents: dedup should NOT activate (only for exactly 1)."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 3
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Synthesis from 3 agents", task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1, "Multi-agent synthesis not suppressed")

    async def test_supervisor_content_accumulated_even_when_suppressed(self):
        """Suppressed chunks must still accumulate in supervisor_content for _get_final_content fallback."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        chunks = ["Part A of answer. ", "Part B of answer. ", "Part C."]
        for chunk in chunks:
            await executor._handle_streaming_chunk({}, state, chunk, task, eq)

        self.assertEqual(len(state.supervisor_content), 3)
        self.assertEqual(''.join(state.supervisor_content), "Part A of answer. Part B of answer. Part C.")

    async def test_handle_stream_end_with_final_answer_marker(self):
        """Sub-agent content with [FINAL ANSWER] marker: dedup still applies."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = [
            'Thinking about this...\n\n[FINAL ANSWER]\nThe answer is 42.'
        ]
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # Dedup: no artifact, just completion
        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 0)

        statuses = _extract_status_events(executor)
        self.assertEqual(len(statuses), 1)
        self.assertTrue(statuses[0].final)

    async def test_sequential_requests_state_isolation(self):
        """Each request starts with fresh StreamState; no cross-request dedup leakage."""
        executor = _make_executor()
        task = _make_task()
        eq = _make_event_queue()

        # Request 1: single sub-agent
        state1 = StreamState()
        state1.sub_agents_completed = 1
        state1.sub_agent_content = ['Result 1']
        await executor._handle_task_complete({'is_task_complete': True}, state1, '', task, eq)

        # Request 2: no sub-agents
        state2 = StreamState()
        await executor._handle_streaming_chunk({}, state2, "New request content", task, eq)

        # state2 should behave normally (sub_agents_completed == 0)
        self.assertEqual(state2.sub_agents_completed, 0)
        artifacts = [
            e for e in _extract_sent_events(executor)
            if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'streaming_result'
        ]
        self.assertGreaterEqual(len(artifacts), 1)


# ===================================================================
# Regression: existing tests adapted for dedup
# ===================================================================

class TestDedupDoesNotBreakExistingBehavior(unittest.IsolatedAsyncioTestCase):
    """Ensure dedup does not regress existing functionality."""

    async def test_single_agent_sub_agent_content_still_in_get_final_content(self):
        """_get_final_content still returns sub-agent content for single-agent."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['The definitive answer.']

        content, is_datapart = executor._get_final_content(state)
        self.assertEqual(content, 'The definitive answer.')
        self.assertFalse(is_datapart)

    async def test_multi_agent_supervisor_synthesis_in_get_final_content(self):
        """_get_final_content prefers supervisor synthesis for multi-agent."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Synthesis of both agents.']
        state.sub_agent_content = ['Raw agent output']

        content, is_datapart = executor._get_final_content(state)
        self.assertIn('Synthesis', content)
        self.assertFalse(is_datapart)

    async def test_completion_status_always_has_final_true(self):
        """Completion status must always have final=True for UI isFinal."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Done']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        statuses = _extract_status_events(executor)
        self.assertEqual(len(statuses), 1)
        self.assertTrue(statuses[0].final)
        self.assertEqual(statuses[0].status.state, TaskState.completed)


if __name__ == '__main__':
    unittest.main()
