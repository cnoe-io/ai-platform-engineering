# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for A2A executor streaming event handling (tool notifications,
execution plan sync, narrative streaming, final result, ordering).
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

def _make_task(task_id="task-streaming-1", context_id="ctx-streaming-1"):
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


def _artifact_text(artifact):
    """Best-effort text from first TextPart."""
    part0 = artifact.parts[0]
    root = part0.root
    return getattr(root, 'text', None) or ''


# ===================================================================
# T033 — Tool notification sourceAgent
# ===================================================================

class TestToolNotificationSourceAgent(unittest.IsolatedAsyncioTestCase):
    """Tool notification artifacts carry tool name as sourceAgent (not generic task/supervisor)."""

    async def test_tool_call_event_creates_notification_with_source_agent(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'github'}},
            state,
            '🔧 Supervisor: Calling Agent Github...\n',
            task,
            eq,
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'tool_notification_start')
        self.assertEqual(artifacts[0].artifact.metadata.get('sourceAgent'), 'github')

    async def test_tool_result_event_creates_end_notification(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_result': {'name': 'github'}},
            state,
            '✅ Supervisor: Agent task Github completed\n',
            task,
            eq,
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'tool_notification_end')
        self.assertEqual(artifacts[0].artifact.metadata.get('sourceAgent'), 'github')

    async def test_write_todos_tool_notification(self):
        """write_todos calls emit start notification with sourceAgent write_todos."""
        executor = _make_executor()
        state = StreamState()
        # No parseable plan — only the tool notification should appear
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'write_todos'}},
            state,
            '🔧 Supervisor: Calling Agent Write_Todos...\n',
            task,
            eq,
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'tool_notification_start')
        self.assertEqual(artifacts[0].artifact.metadata.get('sourceAgent'), 'write_todos')


# ===================================================================
# T034 — Execution plan artifact
# ===================================================================

class TestExecutionPlanArtifact(unittest.IsolatedAsyncioTestCase):
    """Structured execution plan is emitted when write_todos runs with plan text in state."""

    async def test_execution_plan_update_emitted(self):
        executor = _make_executor()
        state = StreamState()
        state.supervisor_content = ['⏳ [Github] Fetch user profile\n']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'write_todos'}},
            state,
            '🔧 Supervisor: Calling Agent Write_Todos...\n',
            task,
            eq,
        )

        artifacts = _extract_artifacts(executor)
        names = [a.artifact.name for a in artifacts]
        self.assertIn('tool_notification_start', names)
        plan_names = {'execution_plan_update', 'execution_plan_status_update'}
        self.assertTrue(plan_names.intersection(set(names)), f'expected plan artifact, got {names}')

        plan_artifacts = [a for a in artifacts if a.artifact.name in plan_names]
        self.assertEqual(len(plan_artifacts), 1)
        data = plan_artifacts[0].artifact.parts[0].root.data
        steps = data.get('steps', [])
        self.assertTrue(
            any((s.get('agent') or '').lower() == 'github' for s in steps),
            steps,
        )


# ===================================================================
# T035 — Streaming result narrative
# ===================================================================

class TestStreamingResultContent(unittest.IsolatedAsyncioTestCase):
    """Plain text chunks are forwarded as streaming_result artifacts."""

    async def test_narrative_text_streamed_as_artifact(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, 'Here is the narrative.', task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'streaming_result')
        self.assertEqual(_artifact_text(artifacts[0].artifact), 'Here is the narrative.')

    async def test_multiple_narrative_chunks_append(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, 'One.', task, eq)
        await executor._handle_streaming_chunk({}, state, ' Two.', task, eq)
        await executor._handle_streaming_chunk({}, state, ' Three.', task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 3)
        for a in artifacts:
            self.assertEqual(a.artifact.name, 'streaming_result')
        self.assertFalse(artifacts[0].append)
        self.assertTrue(artifacts[1].append)
        self.assertTrue(artifacts[2].append)

    async def test_narrative_after_subagent_still_forwarded(self):
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, 'After sub-agent synthesis.', task, eq)

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'streaming_result')


# ===================================================================
# T036 — Final result presence
# ===================================================================

class TestFinalResultPresence(unittest.IsolatedAsyncioTestCase):
    """final_result carries non-empty text from final_model_content or accumulated state."""

    async def test_task_complete_with_final_model_content(self):
        executor = _make_executor()
        state = StreamState()
        state.final_model_content = 'The answer.'
        # supervisor_chunks_yielded=0 (default) triggers deterministic chunking:
        # one streaming_result chunk + one final_result artifact.
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        # Deterministic chunking emits streaming_result(s) before final_result
        streaming = [a for a in artifacts if a.artifact.name == 'streaming_result']
        final = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertGreaterEqual(len(streaming), 1, "Expected at least one streaming_result chunk")
        self.assertEqual(len(final), 1, "Expected exactly one final_result")
        self.assertEqual(_artifact_text(final[0].artifact), 'The answer.')
        # Streaming chunks together reconstruct the answer
        streamed_text = ''.join(_artifact_text(a.artifact) for a in streaming)
        self.assertIn('The answer', streamed_text)

    async def test_task_complete_without_final_model_content_uses_accumulated(self):
        executor = _make_executor()
        state = StreamState()
        state.sub_agent_content = ['Fallback.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].artifact.name, 'final_result')
        self.assertIn('Fallback.', _artifact_text(artifacts[0].artifact))

    async def test_stream_end_with_final_model_content(self):
        executor = _make_executor()
        state = StreamState()
        state.final_model_content = 'The answer.'
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        self.assertEqual(_artifact_text(final_results[0].artifact), 'The answer.')

    async def test_deterministic_chunking_skipped_when_live_streaming(self):
        """When supervisor chunks were already yielded live, no duplicate chunks emitted."""
        executor = _make_executor()
        state = StreamState()
        state.final_model_content = 'The answer.'
        task = _make_task()
        eq = _make_event_queue()

        # streaming_chunks_yielded > 0 means agent.py already streamed live tokens
        await executor._handle_task_complete(
            {'is_task_complete': True, 'streaming_chunks_yielded': 5}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        # No streaming_result chunks; only final_result
        streaming = [a for a in artifacts if a.artifact.name == 'streaming_result']
        final = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(streaming), 0, "Must not re-emit chunks when already streamed live")
        self.assertEqual(len(final), 1)
        self.assertEqual(_artifact_text(final[0].artifact), 'The answer.')

    async def test_deterministic_chunking_long_content_splits(self):
        """Long final_model_content is split into multiple streaming_result chunks."""
        executor = _make_executor()
        state = StreamState()
        # ~600 chars — should produce at least 2 chunks with target_chunk_size=200
        state.final_model_content = ' '.join(['word'] * 120)
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        streaming = [a for a in artifacts if a.artifact.name == 'streaming_result']
        final = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertGreater(len(streaming), 1, "Long content should produce multiple chunks")
        self.assertEqual(len(final), 1)
        # All chunks share the same artifact_id (append protocol)
        artifact_ids = {a.artifact.artifact_id for a in streaming}
        self.assertEqual(len(artifact_ids), 1, "All chunks must share one artifact_id")
        # Reconstructed text equals original (accounting for inter-chunk spaces)
        reconstructed = ''.join(_artifact_text(a.artifact) for a in streaming)
        self.assertEqual(reconstructed, state.final_model_content)


# ===================================================================
# T037 — Event ordering
# ===================================================================

class TestEventOrdering(unittest.IsolatedAsyncioTestCase):
    """Notifications, streaming, sub-agent complete, then final_result precede completion status."""

    async def test_notification_before_streaming_before_final(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'github'}},
            state,
            '🔧 Supervisor: Calling Agent Github...\n',
            task,
            eq,
        )
        await executor._handle_streaming_chunk({}, state, 'Streaming line.', task, eq)

        complete_event = {
            'result': {
                'artifact': {
                    'name': 'complete_result',
                    'parts': [{'text': 'Complete body from sub-agent.'}],
                    'artifactId': str(uuid.uuid4()),
                    'metadata': {'sourceAgent': 'github'},
                },
                'lastChunk': True,
            }
        }
        await executor._handle_sub_agent_artifact(complete_event, state, task, eq)

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        names = [a.artifact.name for a in artifacts]
        self.assertEqual(
            names,
            [
                'tool_notification_start',
                'streaming_result',
                'complete_result',
                'final_result',
            ],
        )

        statuses = _extract_status_events(executor)
        self.assertEqual(len(statuses), 1)
        self.assertEqual(statuses[0].status.state, TaskState.completed)
        self.assertTrue(statuses[0].final)


if __name__ == '__main__':
    unittest.main()
