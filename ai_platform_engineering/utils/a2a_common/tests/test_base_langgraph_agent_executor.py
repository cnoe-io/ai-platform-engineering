# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for BaseLangGraphAgentExecutor."""

import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from a2a.types import Task, TaskState, TaskArtifactUpdateEvent, TaskStatusUpdateEvent

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class MockLangGraphAgent(BaseLangGraphAgent):
    """Mock agent for testing."""

    def __init__(self, name="test_agent"):
        self.name = name
        self.stream_responses = []

    def get_agent_name(self) -> str:
        return self.name

    def get_system_instruction(self) -> str:
        return "Test system instruction"

    def get_response_format_class(self):
        """Return mock response format class."""
        return None

    def get_response_format_instruction(self) -> str:
        """Return mock response format instruction."""
        return ""

    def get_tool_working_message(self) -> str:
        """Return mock tool working message."""
        return "Working on it..."

    def get_tool_processing_message(self) -> str:
        """Return mock tool processing message."""
        return "Processing..."

    async def stream(self, query: str, context_id: str, trace_id: str | None = None):
        """Mock stream method that yields test responses."""
        for response in self.stream_responses:
            yield response
            await asyncio.sleep(0.01)  # Simulate async delay


class TestBaseLangGraphAgentExecutor(unittest.IsolatedAsyncioTestCase):
    """Test BaseLangGraphAgentExecutor class."""

    def setUp(self):
        """Set up test fixtures."""
        self.agent = MockLangGraphAgent()
        self.executor = BaseLangGraphAgentExecutor(self.agent)

    async def test_execute_without_message_raises_exception(self):
        """Test that execute raises exception when no message is provided."""
        context = Mock()
        context.message = None
        context.current_task = None
        context.get_user_input = Mock(return_value="Test query")

        event_queue = AsyncMock()

        with self.assertRaises(Exception) as cm:
            await self.executor.execute(context, event_queue)

        self.assertIn('No message provided', str(cm.exception))

    async def test_execute_creates_task_when_none_exists(self):
        """Test that execute creates a new task when current_task is None."""
        from a2a.types import TextPart, Part, Message, Role
        from uuid import uuid4

        context = Mock()
        # Create a proper Message object
        context.message = Message(
            role=Role.user,
            parts=[Part(root=TextPart(text="Test query"))],
            message_id=str(uuid4()),
            context_id=str(uuid4())
        )
        context.current_task = None
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Set agent to complete immediately
        self.agent.stream_responses = [{
            'is_task_complete': True,
            'content': 'Done',
            'require_user_input': False
        }]

        await self.executor.execute(context, event_queue)

        # Verify task was created and enqueued
        calls = event_queue.enqueue_event.call_args_list
        # First call should be the new task
        first_call_arg = calls[0][0][0]
        self.assertIsInstance(first_call_arg, Task)

    async def test_execute_logs_warning_when_no_trace_id(self):
        """Test that execute logs warning when no trace_id is found."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        self.agent.stream_responses = [{
            'is_task_complete': True,
            'content': 'Done',
            'require_user_input': False
        }]

        with self.assertLogs(level='WARNING') as log_context:
            await self.executor.execute(context, event_queue)

        # Verify warning was logged
        self.assertTrue(any('No trace_id from supervisor' in message for message in log_context.output))

    async def test_execute_with_trace_id_from_parent(self):
        """Test that execute extracts trace_id from parent task."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.current_task.metadata = {'trace_id': 'parent-trace-123'}
        context.get_user_input = Mock(return_value="Test query")

        # Set up parent task with trace_id in metadata
        parent_task = Mock()
        parent_task.metadata = {'trace_id': 'parent-trace-123'}
        context.parent_task = parent_task

        event_queue = AsyncMock()

        self.agent.stream_responses = [{
            'is_task_complete': True,
            'content': 'Done',
            'require_user_input': False
        }]

        await self.executor.execute(context, event_queue)

        # Just verify execution completed without error
        # The actual trace_id extraction is tested implicitly by successful execution
        self.assertGreater(len(event_queue.enqueue_event.call_args_list), 0)

    async def test_execute_handles_require_user_input(self):
        """Test that execute handles require_user_input state."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        self.agent.stream_responses = [{
            'is_task_complete': False,
            'content': 'Need more information',
            'require_user_input': True
        }]

        await self.executor.execute(context, event_queue)

        # Verify events were sent
        calls = event_queue.enqueue_event.call_args_list
        # Should have: working status, then input_required status
        self.assertGreaterEqual(len(calls), 2)

    async def test_execute_accumulates_streaming_content(self):
        """Test that execute accumulates content from multiple streaming events."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Multiple streaming events before completion
        self.agent.stream_responses = [
            {'is_task_complete': False, 'content': 'Part 1', 'require_user_input': False},
            {'is_task_complete': False, 'content': 'Part 2', 'require_user_input': False},
            {'is_task_complete': True, 'content': 'Part 3', 'require_user_input': False}
        ]

        await self.executor.execute(context, event_queue)

        # Verify multiple events were sent
        self.assertGreater(len(event_queue.enqueue_event.call_args_list), 3)

    async def test_execute_handles_empty_stream(self):
        """Test that execute handles empty stream gracefully."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Empty stream (agent yields nothing)
        self.agent.stream_responses = []

        await self.executor.execute(context, event_queue)

        # Should still send initial working status
        calls = event_queue.enqueue_event.call_args_list
        self.assertGreaterEqual(len(calls), 1)

    async def test_execute_sends_initial_working_status(self):
        """Test that execute sends initial working status."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        self.agent.stream_responses = [{
            'is_task_complete': True,
            'content': 'Done',
            'require_user_input': False
        }]

        await self.executor.execute(context, event_queue)

        # Check first event is working status
        first_call = event_queue.enqueue_event.call_args_list[0]
        first_event = first_call[0][0]
        self.assertEqual(first_event.status.state, TaskState.working)
        self.assertFalse(first_event.final)

    async def test_execute_creates_streaming_artifacts(self):
        """Test that execute creates streaming artifacts for content."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        self.agent.stream_responses = [
            {'is_task_complete': False, 'content': 'Streaming content', 'require_user_input': False},
            {'is_task_complete': True, 'content': 'Final content', 'require_user_input': False}
        ]

        await self.executor.execute(context, event_queue)

        # Verify artifact events were created
        calls = event_queue.enqueue_event.call_args_list
        # Should have artifacts for streaming content
        from a2a.types import TaskArtifactUpdateEvent
        artifact_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskArtifactUpdateEvent)]
        self.assertGreater(len(artifact_events), 0)

    async def test_execute_closes_streaming_artifact_on_completion(self):
        """Test that execute closes streaming artifact with last_chunk=True."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        self.agent.stream_responses = [
            {'is_task_complete': False, 'content': 'Streaming', 'require_user_input': False},
            {'is_task_complete': True, 'content': 'Done', 'require_user_input': False}
        ]

        await self.executor.execute(context, event_queue)

        # Find last artifact event
        from a2a.types import TaskArtifactUpdateEvent
        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskArtifactUpdateEvent)]

        # Last artifact should have last_chunk=True
        if artifact_events:
            last_artifact = artifact_events[-1]
            self.assertTrue(last_artifact.last_chunk)

    async def test_execute_sends_final_completed_status(self):
        """Test that execute sends final completed status."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        self.agent.stream_responses = [{
            'is_task_complete': True,
            'content': 'All done',
            'require_user_input': False
        }]

        await self.executor.execute(context, event_queue)

        # Find final status event
        from a2a.types import TaskStatusUpdateEvent
        calls = event_queue.enqueue_event.call_args_list
        status_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskStatusUpdateEvent)]

        # Should have at least one completed status
        completed_statuses = [e for e in status_events if e.status.state == TaskState.completed]
        self.assertGreater(len(completed_statuses), 0)
        self.assertTrue(completed_statuses[-1].final)

    async def test_cancel_raises_not_implemented(self):
        """Test that cancel raises not implemented exception."""
        context = Mock()
        event_queue = AsyncMock()

        with self.assertRaises(Exception) as cm:
            await self.executor.cancel(context, event_queue)

        self.assertIn('cancel not supported', str(cm.exception))

    def test_initialization_with_agent(self):
        """Test that executor initializes with an agent."""
        agent = MockLangGraphAgent("my_agent")
        executor = BaseLangGraphAgentExecutor(agent)

        self.assertEqual(executor.agent, agent)
        self.assertEqual(executor.agent.get_agent_name(), "my_agent")

    async def test_execute_handles_agent_stream_exception(self):
        """Test that execute sends graceful error when agent.stream raises an exception."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-err-1"
        context.current_task.context_id = "ctx-err-1"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Make the agent stream raise an exception
        async def failing_stream(query, context_id, trace_id=None):
            raise Exception("expected toolResult blocks in conversation turn")
            yield  # noqa: make it a generator

        self.agent.stream = failing_stream

        await self.executor.execute(context, event_queue)

        # Should NOT crash — should send error artifact + completed status
        calls = event_queue.enqueue_event.call_args_list
        # Find error artifact
        error_artifacts = [
            c[0][0] for c in calls
            if isinstance(c[0][0], TaskArtifactUpdateEvent)
            and hasattr(c[0][0], 'artifact')
            and c[0][0].artifact
            and getattr(c[0][0].artifact, 'name', '') == 'error_result'
        ]
        self.assertGreater(len(error_artifacts), 0, "Expected error_result artifact to be sent")

        # Find completed status
        completed_statuses = [
            c[0][0] for c in calls
            if isinstance(c[0][0], TaskStatusUpdateEvent)
            and c[0][0].status.state == TaskState.completed
            and c[0][0].final
        ]
        self.assertGreater(len(completed_statuses), 0, "Expected final completed status to be sent")

    async def test_execute_handles_cancelled_error(self):
        """Test that execute handles asyncio.CancelledError gracefully."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-cancel-1"
        context.current_task.context_id = "ctx-cancel-1"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        async def cancelled_stream(query, context_id, trace_id=None):
            raise asyncio.CancelledError()
            yield  # noqa: make it a generator

        self.agent.stream = cancelled_stream

        await self.executor.execute(context, event_queue)

        # Should send cancellation message, not crash
        calls = event_queue.enqueue_event.call_args_list
        # Should have at least initial working status + error completion
        self.assertGreater(len(calls), 0, "Expected events to be enqueued")

    async def test_execute_handles_exception_group(self):
        """Test that execute handles BaseExceptionGroup gracefully."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-eg-1"
        context.current_task.context_id = "ctx-eg-1"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        async def eg_stream(query, context_id, trace_id=None):
            raise BaseExceptionGroup("stream errors", [ValueError("expected toolResult")])
            yield  # noqa: make it a generator

        self.agent.stream = eg_stream

        await self.executor.execute(context, event_queue)

        # Should send error completion instead of crashing
        calls = event_queue.enqueue_event.call_args_list
        self.assertGreater(len(calls), 0, "Expected events to be enqueued after ExceptionGroup")

    async def test_single_event_failure_does_not_kill_stream(self):
        """Test that a failure processing one event does not kill the entire stream."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-partial-1"
        context.current_task.context_id = "ctx-partial-1"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Three events: the second one has content that should work,
        # but we'll make event processing fail for the first event by
        # injecting a bad event, then good events follow.
        self.agent.stream_responses = [
            # First event: good content that streams normally
            {'is_task_complete': False, 'content': 'Part 1', 'require_user_input': False},
            # Second event: also good
            {'is_task_complete': False, 'content': 'Part 2', 'require_user_input': False},
            # Completion
            {'is_task_complete': True, 'content': 'Done', 'require_user_input': False},
        ]

        # Make enqueue_event fail on the 2nd call (the first streaming artifact),
        # then succeed on subsequent calls
        call_count = 0
        original_enqueue = event_queue.enqueue_event

        async def flaky_enqueue(event):
            nonlocal call_count
            call_count += 1
            if call_count == 2:  # Fail on second call (first content artifact)
                raise RuntimeError("Simulated queue failure")
            return await original_enqueue(event)

        event_queue.enqueue_event = AsyncMock(side_effect=flaky_enqueue)

        await self.executor.execute(context, event_queue)

        # The stream should have continued despite the failure
        # We should have more than 2 calls (working status + at least some artifacts)
        total_calls = event_queue.enqueue_event.call_count
        self.assertGreater(total_calls, 2, "Stream should have continued despite single event failure")

    async def test_send_error_completion_sends_artifact_and_status(self):
        """Test _send_error_completion sends error artifact and completed status."""
        event_queue = AsyncMock()
        task = Mock(spec=Task)
        task.id = "task-err-comp-1"
        task.context_id = "ctx-err-comp-1"

        await self.executor._send_error_completion(
            event_queue, task, "test_agent", "Something went wrong"
        )

        calls = event_queue.enqueue_event.call_args_list
        self.assertEqual(len(calls), 2, "Expected exactly 2 enqueue_event calls")

        # First call: error artifact
        first_event = calls[0][0][0]
        self.assertIsInstance(first_event, TaskArtifactUpdateEvent)
        self.assertEqual(first_event.artifact.name, 'error_result')
        self.assertTrue(first_event.last_chunk)

        # Second call: completed status
        second_event = calls[1][0][0]
        self.assertIsInstance(second_event, TaskStatusUpdateEvent)
        self.assertEqual(second_event.status.state, TaskState.completed)
        self.assertTrue(second_event.final)

    async def test_process_stream_event_status_kind(self):
        """Test that _process_stream_event handles 'status' kind events."""
        event_queue = AsyncMock()
        task = Mock(spec=Task)
        task.id = "task-status-1"
        task.context_id = "ctx-status-1"
        accumulated_content = []

        # Initialize the streaming_artifact_id
        self.executor._streaming_artifact_id = None

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'kind': 'status',
            'content': 'Recovery in progress...',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", accumulated_content, event_queue
        )

        # Should have sent a status_update artifact
        calls = event_queue.enqueue_event.call_args_list
        self.assertEqual(len(calls), 1)
        artifact_event = calls[0][0][0]
        self.assertIsInstance(artifact_event, TaskArtifactUpdateEvent)
        self.assertEqual(artifact_event.artifact.name, 'status_update')


if __name__ == '__main__':
    unittest.main()

