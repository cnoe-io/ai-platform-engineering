# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for streaming behaviour in the A2A executor.

The supervisor always emits a final_result artifact before sending the
completion status, for both single and multi-agent scenarios (when there
is content to send).

Key invariants:
  1. All streaming chunks are forwarded as streaming_result artifacts,
     including after a sub-agent completes (sub_agents_completed == 1).
     Supervisor text still accumulates in state.supervisor_content for
     final_result selection when appropriate.
  2. Tool notifications are ALWAYS forwarded regardless of sub-agent state.
  3. _get_final_content: DataPart first; for multi-agent (sub_agents_completed
     > 1) prefers supervisor_content; for single sub-agent (== 1) prefers
     sub_agent_content over supervisor_content. _handle_stream_end /
     _handle_task_complete prefer state.final_model_content when set (clean
     last model summary).
  4. final_result is sent before the completion status when there is final
     content; DataPart and empty-edge cases follow executor rules.
  5. DataPart (structured data) bypasses all text content rules.

Expected SSE event flow for single sub-agent (post complete_result chunks
still forwarded as streaming_result):

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
  15. streaming_result chunks (supervisor may continue; all forwarded)
  16. final_result (final_model_content or _get_final_content selection)
  17. status-update (completed, final=true)                     <-- isFinal
"""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
)
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    StreamState,
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
        executor._current_plan_step_id = None
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
# _handle_streaming_chunk — Suppression Tests
# ===================================================================

class TestStreamingChunkSuppression(unittest.IsolatedAsyncioTestCase):
    """
    After a single sub-agent sends complete_result (sub_agents_completed == 1),
    non-notification streaming chunks from the supervisor are still forwarded
    as streaming_result; they also accumulate in supervisor_content.
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

    async def test_chunks_after_single_subagent_completion_are_forwarded(self):
        """After 1 sub-agent completes, streaming chunks are still forwarded as artifacts."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1  # Sub-agent already sent complete_result
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Here is the result:", task, eq)
        await executor._handle_streaming_chunk({}, state, " ArgoCD v2.9.3", task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 2)
        self.assertEqual(artifacts[0].artifact.name, 'streaming_result')
        self.assertFalse(artifacts[0].append)
        self.assertTrue(artifacts[1].append)

        # Content is accumulated in supervisor_content for later use as final_result
        self.assertIn("Here is the result:", state.supervisor_content)
        self.assertIn(" ArgoCD v2.9.3", state.supervisor_content)

    async def test_tool_notifications_always_forwarded_after_subagent_completion(self):
        """Tool notifications (write_todos, etc.) are ALWAYS forwarded, even after sub-agent completion."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

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
        """Empty content returns early regardless of state."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, '', task, eq)
        self.assertEqual(len(_extract_sent_events(executor)), 0)

    async def test_chunks_after_subagent_completion_create_streaming_artifact_id(self):
        """Forwarded chunks after sub-agent completion set streaming_artifact_id."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Post-completion content", task, eq)

        self.assertIsNotNone(state.streaming_artifact_id)

    async def test_suppressed_chunks_accumulate_in_supervisor_content(self):
        """Suppressed chunks must accumulate in supervisor_content for use as final_result."""
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


# ===================================================================
# _get_final_content — Content Priority Tests
# ===================================================================

class TestGetFinalContent(unittest.IsolatedAsyncioTestCase):
    """
    _get_final_content: DataPart first; single sub-agent (==1) prefers
    sub_agent_content over supervisor_content; multi-agent (>1) prefers
    supervisor_content when both exist.
    """

    async def test_datapart_has_highest_priority(self):
        """DataPart is always returned first, regardless of other content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agent_datapart = {'chart_type': 'bar', 'data': [1, 2, 3]}
        state.supervisor_content = ['Supervisor synthesis']
        state.sub_agent_content = ['Sub-agent text']

        content, is_datapart = executor._get_final_content(state)
        self.assertTrue(is_datapart)
        self.assertEqual(content, {'chart_type': 'bar', 'data': [1, 2, 3]})

    async def test_sub_agent_content_preferred_for_single_agent(self):
        """Single sub-agent: sub_agent_content wins when both are present."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.supervisor_content = ['Supervisor synthesis answer.']
        state.sub_agent_content = ['Raw sub-agent output']

        content, is_datapart = executor._get_final_content(state)
        self.assertFalse(is_datapart)
        self.assertIn('Raw sub-agent', content)
        self.assertNotIn('Supervisor synthesis', content)

    async def test_supervisor_content_preferred_for_multi_agent_when_both_present(self):
        """Multi-agent: supervisor_content wins when both supervisor and sub-agent exist."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Supervisor synthesis answer.']
        state.sub_agent_content = ['Raw sub-agent output']

        content, is_datapart = executor._get_final_content(state)
        self.assertFalse(is_datapart)
        self.assertIn('Supervisor synthesis', content)
        self.assertNotIn('Raw sub-agent', content)

    async def test_supervisor_content_preferred_for_multi_agent(self):
        """Supervisor synthesis preferred for multi-agent scenarios too."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Synthesis of both agents.']
        state.sub_agent_content = ['Raw agent output']

        content, is_datapart = executor._get_final_content(state)
        self.assertIn('Synthesis', content)
        self.assertFalse(is_datapart)

    async def test_sub_agent_content_fallback_when_no_supervisor(self):
        """Sub-agent content returned when supervisor produced nothing."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['The definitive answer.']
        # supervisor_content intentionally empty

        content, is_datapart = executor._get_final_content(state)
        self.assertEqual(content, 'The definitive answer.')
        self.assertFalse(is_datapart)

    async def test_final_answer_marker_extracted_from_supervisor_content(self):
        """[FINAL ANSWER] marker is stripped and only content after it is returned."""
        executor = _make_executor()
        state = StreamState()
        state.supervisor_content = [
            'Thinking step.\n',
            '[FINAL ANSWER]\n',
            'Clean synthesis here.',
        ]

        content, _ = executor._get_final_content(state)
        self.assertIn('Clean synthesis here.', content)
        self.assertNotIn('[FINAL ANSWER]', content)
        self.assertNotIn('Thinking step', content)

    async def test_empty_all_sources_returns_empty_string(self):
        """When all content sources are empty, returns empty string."""
        executor = _make_executor()
        state = StreamState()

        content, is_datapart = executor._get_final_content(state)
        self.assertEqual(content, '')
        self.assertFalse(is_datapart)


# ===================================================================
# _handle_stream_end — Final Result Tests
# ===================================================================

class TestStreamEnd(unittest.IsolatedAsyncioTestCase):
    """
    _handle_stream_end must always send final_result when content is available,
    followed by a completion status event. No special-casing for single vs
    multi-agent scenarios.
    """

    async def test_single_agent_sends_final_result_with_sub_agent_content(self):
        """Single sub-agent: final_result sent with sub-agent content (supervisor_content empty)."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['ArgoCD version is v2.9.3 with Helm v3.14.0 and Kustomize v5.3.0.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1, "final_result must be sent")
        self.assertEqual(artifacts[0].artifact.name, 'final_result')

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertEqual(status_events[0].status.state, TaskState.completed)
        self.assertTrue(status_events[0].final)

    async def test_single_agent_sends_supervisor_synthesis_when_available(self):
        """Single sub-agent: sub_agent_content preferred over supervisor synthesis for final_result."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Raw sub-agent output']
        state.supervisor_content = [
            'Thinking...\n',
            '[FINAL ANSWER]\n',
            'The synthesized answer from the supervisor.',
        ]
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'final_result')
        text = artifacts[0].artifact.parts[0].root.text
        self.assertIn('Raw sub-agent output', text)
        self.assertNotIn('synthesized answer', text)

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertTrue(status_events[0].final)

    async def test_multi_agent_sends_final_result(self):
        """Multi-agent (2+): final_result with synthesized content is sent."""
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

    async def test_no_content_sends_completion_only(self):
        """No content from any source: sends only completion status."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = []
        # supervisor_content also empty
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertTrue(status_events[0].final)

    async def test_datapart_sends_artifact(self):
        """DataPart results are always sent."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_datapart = {'chart_type': 'bar', 'data': [1, 2, 3]}
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)

    async def test_trace_id_propagated_to_final_result(self):
        """trace_id in state must appear in the final_result artifact metadata."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Answer.']
        state.trace_id = 'trace-xyz789'
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        self.assertEqual(final_results[0].artifact.metadata.get('trace_id'), 'trace-xyz789')


# ===================================================================
# _handle_task_complete — Final Result Tests
# ===================================================================

class TestTaskComplete(unittest.IsolatedAsyncioTestCase):
    """
    _handle_task_complete must always send final_result when content is
    available. No special-casing for single vs multi-agent scenarios.
    """

    async def test_single_agent_sends_final_result_with_sub_agent_content(self):
        """Single sub-agent, no supervisor content: final_result uses sub-agent content."""
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
        self.assertEqual(len(artifacts), 1, "final_result must be sent")
        self.assertEqual(artifacts[0].artifact.name, 'final_result')

        status_events = _extract_status_events(executor)
        self.assertEqual(len(status_events), 1)
        self.assertEqual(status_events[0].status.state, TaskState.completed)
        self.assertTrue(status_events[0].final)

    async def test_single_agent_prefers_supervisor_synthesis(self):
        """Single sub-agent: sub_agent_content used as final_result when both are present."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Raw sub-agent output']
        state.supervisor_content = ['[FINAL ANSWER]\nSupervisor synthesized answer.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        text = artifacts[0].artifact.parts[0].root.text
        self.assertIn('Raw sub-agent output', text)
        self.assertNotIn('Supervisor synthesized answer', text)

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
        text = artifacts[-1].artifact.parts[0].root.text
        self.assertIn('Fallback content from event', text)

    async def test_datapart_sends_artifact(self):
        """DataPart is always sent regardless of text content state."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_datapart = {'form_fields': [{'name': 'repo'}]}
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        self.assertGreaterEqual(len(artifacts), 1)

    async def test_completion_status_always_final_true(self):
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

    async def test_trace_id_propagated_to_final_result(self):
        """trace_id from state must appear in final_result metadata."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Answer.']
        state.trace_id = 'trace-abc123'
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        self.assertEqual(final_results[0].artifact.metadata.get('trace_id'), 'trace-abc123')


# ===================================================================
# End-to-End SSE Pattern Tests (based on real captures)
# ===================================================================

class TestEndToEndGitHubProfilePattern(unittest.IsolatedAsyncioTestCase):
    """
    Simulates the real SSE pattern from a GitHub profile query.
    Verifies the full event sequence.

    Expected pattern (sanitized):
      supervisor streams intro → write_todos → sub-agent streams → tools →
      sub-agent streams answer → complete_result (forwarded) →
      supervisor post-complete chunks (forwarded as streaming_result and
      accumulated in supervisor_content) →
      final_result (sub_agent_content preferred for single sub-agent) →
      status: completed (final=true)
    """

    async def test_github_profile_full_flow(self):
        """Simulate complete GitHub profile flow, verify final_result always sent."""
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

        # Phase 6: Supervisor re-streams content (forwarded as streaming_result
        # and accumulated in supervisor_content)
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

        # Phase 8: Task completion — must always send final_result
        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        # === Assertions ===
        all_artifacts = _extract_artifacts(executor)
        all_statuses = _extract_status_events(executor)

        artifact_names = [a.artifact.name for a in all_artifacts]
        complete_count = artifact_names.count('complete_result')
        final_count = artifact_names.count('final_result')
        streaming_count = artifact_names.count('streaming_result')
        notif_start_count = artifact_names.count('tool_notification_start')

        # Exactly 1 complete_result (from sub-agent)
        self.assertEqual(complete_count, 1, "Exactly 1 complete_result expected")

        # Always 1 final_result (sub_agent_content preferred for single sub-agent)
        self.assertEqual(final_count, 1, "final_result must always be sent")

        # Streaming: 3 pre-subagent + 3 post-subagent supervisor chunks (all forwarded)
        self.assertEqual(streaming_count, 6,
                         "Pre- and post-subagent streaming chunks forwarded")

        # Tool notifications always forwarded (3 total: write_todos, github, write_todos)
        self.assertEqual(notif_start_count, 3,
                         "All tool notifications forwarded")

        # Exactly 1 completion status
        self.assertEqual(len(all_statuses), 1)
        self.assertTrue(all_statuses[0].final)
        self.assertEqual(all_statuses[0].status.state, TaskState.completed)


class TestEndToEndArgocdVersionPattern(unittest.IsolatedAsyncioTestCase):
    """
    Simulates the real SSE pattern from an ArgoCD version query.
    Pattern is nearly identical to GitHub but with different sub-agent.
    """

    async def test_argocd_version_full_flow(self):
        """Simulate ArgoCD version flow, verify final_result always sent."""
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

        # Supervisor re-streams (forwarded and accumulated in supervisor_content)
        await executor._handle_streaming_chunk({}, state, "Here's the ArgoCD version", task, eq)
        await executor._handle_streaming_chunk({}, state, " v2.9.3 running on linux.", task, eq)

        # write_todos update notification (always forwarded)
        await executor._handle_streaming_chunk(
            {'tool_result': {'name': 'write_todos'}},
            state,
            '✅ Supervisor: Agent task Write_Todos completed\n',
            task, eq,
        )

        # Stream ends — must send final_result with supervisor_content
        await executor._handle_stream_end(state, task, eq)

        # === Assertions ===
        all_artifacts = _extract_artifacts(executor)
        all_statuses = _extract_status_events(executor)
        artifact_names = [a.artifact.name for a in all_artifacts]

        # 1 complete_result from sub-agent
        self.assertEqual(artifact_names.count('complete_result'), 1)

        # 1 final_result: supervisor accumulated chunks used as synthesis
        self.assertEqual(artifact_names.count('final_result'), 1,
                         "final_result must always be sent")

        # 3 pre-subagent + 2 post-subagent streaming chunks (all forwarded)
        self.assertEqual(artifact_names.count('streaming_result'), 5)

        # Completion
        self.assertEqual(len(all_statuses), 1)
        self.assertTrue(all_statuses[0].final)


class TestEndToEndMultiAgentPattern(unittest.IsolatedAsyncioTestCase):
    """
    Multi-agent scenario: 2 sub-agents complete, supervisor synthesizes.
    final_result with synthesis is expected.
    """

    async def test_multi_agent_sends_synthesis(self):
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

        # Supervisor synthesis streaming (NOT suppressed for 2+ agents)
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

        final = [a for a in all_artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final), 1)


# ===================================================================
# Edge Cases
# ===================================================================

class TestEdgeCases(unittest.IsolatedAsyncioTestCase):
    """Edge cases around content priority and state isolation."""

    async def test_three_subagents_synthesis_not_suppressed(self):
        """3 sub-agents: supervisor synthesis streaming is NOT suppressed."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 3
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, "Synthesis from 3 agents", task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1, "Multi-agent synthesis not suppressed")

    async def test_sequential_requests_state_isolation(self):
        """Each request starts with fresh StreamState; no cross-request leakage."""
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

    async def test_sub_agent_content_with_final_answer_marker_extracted(self):
        """[FINAL ANSWER] marker in sub_agent_content is extracted correctly."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = [
            'Thinking about this...\n\n[FINAL ANSWER]\nThe answer is 42.'
        ]
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        text = artifacts[0].artifact.parts[0].root.text
        self.assertIn('The answer is 42.', text)
        self.assertNotIn('[FINAL ANSWER]', text)

        statuses = _extract_status_events(executor)
        self.assertEqual(len(statuses), 1)
        self.assertTrue(statuses[0].final)

    async def test_multi_chunk_supervisor_content_concatenated(self):
        """Multiple supervisor_content chunks are joined before extraction."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.sub_agent_content = ['raw']
        state.supervisor_content = [
            'Chunk one. ',
            '[FINAL ANSWER]\n',
            'Part A of synthesis. ',
            'Part B of synthesis.',
        ]
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)

        text = final_results[0].artifact.parts[0].root.text
        self.assertIn('Part A of synthesis', text)
        self.assertIn('Part B of synthesis', text)


if __name__ == '__main__':
    unittest.main()
