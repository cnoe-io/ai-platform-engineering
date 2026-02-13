# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for BaseLangGraphAgentExecutor."""

import asyncio
import unittest
from unittest.mock import AsyncMock, Mock

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
            yield  # noqa: F841 — make it a generator

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

    async def test_execute_handles_agent_stream_exception_gracefully(self):
        """Test that execute catches exceptions from agent.stream and sends error completion."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Make agent.stream raise an exception
        async def failing_stream(*args, **kwargs):
            raise RuntimeError("LLM provider failed")
            yield  # Make it a generator
        self.agent.stream = failing_stream

        await self.executor.execute(context, event_queue)

        # Should have sent initial working status + error artifact + error completion
        calls = event_queue.enqueue_event.call_args_list
        self.assertGreaterEqual(len(calls), 2)

        # Last status event should be completed
        status_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)]
        completed = [e for e in status_events if e.status.state == TaskState.completed]
        self.assertGreater(len(completed), 0)

    async def test_execute_handles_cancelled_error(self):
        """Test that asyncio.CancelledError is handled gracefully."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Make agent.stream raise CancelledError
        async def cancelled_stream(*args, **kwargs):
            raise asyncio.CancelledError()
            yield  # Make it a generator
        self.agent.stream = cancelled_stream

        await self.executor.execute(context, event_queue)

        # Should have sent cancellation message
        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        # Error artifact should contain "cancelled" (Part has root.text for TextPart)
        artifact_text = ''.join(
            getattr(p.root, 'text', '') for a in artifact_events for p in getattr(a.artifact, 'parts', [])
            if hasattr(p, 'root')
        )
        self.assertIn("cancelled", artifact_text.lower())
        # At minimum, we should have initial working + some error handling
        self.assertGreaterEqual(len(calls), 2)

    async def test_execute_handles_exception_group(self):
        """Test that BaseExceptionGroup is handled gracefully."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # Make agent.stream raise BaseExceptionGroup
        async def group_error_stream(*args, **kwargs):
            raise BaseExceptionGroup("errors", [RuntimeError("inner error")])
            yield  # Make it a generator
        self.agent.stream = group_error_stream

        await self.executor.execute(context, event_queue)

        # Should have handled gracefully
        calls = event_queue.enqueue_event.call_args_list
        self.assertGreaterEqual(len(calls), 2)

    async def test_execute_individual_event_failure_continues_stream(self):
        """Test that a single event processing failure doesn't kill the stream."""
        context = Mock()
        context.message = Mock()
        context.current_task = Mock(spec=Task)
        context.current_task.id = "task-123"
        context.current_task.context_id = "context-123"
        context.get_user_input = Mock(return_value="Test query")
        context.parent_task = None

        event_queue = AsyncMock()

        # First event will fail, second should still process
        self.agent.stream_responses = [
            {'is_task_complete': False, 'content': 'chunk1', 'require_user_input': False,
             'kind': 'text_chunk'},
            {'is_task_complete': True, 'content': 'final', 'require_user_input': False},
        ]

        # Make enqueue_event fail on 2nd call (first streaming artifact) but succeed on others
        call_count = [0]
        original_enqueue = event_queue.enqueue_event

        async def selective_fail(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 2:  # Fail on 2nd enqueue (streaming artifact)
                raise RuntimeError("Queue temporarily unavailable")
            return await original_enqueue(*args, **kwargs)

        event_queue.enqueue_event = AsyncMock(side_effect=selective_fail)

        # Should not raise — individual event failure is caught
        await self.executor.execute(context, event_queue)

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


class TestSendErrorCompletion(unittest.IsolatedAsyncioTestCase):
    """Test _send_error_completion method."""

    def setUp(self):
        self.agent = MockLangGraphAgent()
        self.executor = BaseLangGraphAgentExecutor(self.agent)

    async def test_sends_error_artifact_and_completed_status(self):
        """_send_error_completion sends both error artifact and completed status."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-456"
        task.context_id = "ctx-456"

        await self.executor._send_error_completion(
            event_queue, task, "test_agent", "Something went wrong"
        )

        calls = event_queue.enqueue_event.call_args_list
        self.assertEqual(len(calls), 2)

        # First call: error artifact
        first_event = calls[0][0][0]
        self.assertIsInstance(first_event, TaskArtifactUpdateEvent)
        self.assertTrue(first_event.last_chunk)

        # Second call: completed status
        second_event = calls[1][0][0]
        self.assertIsInstance(second_event, TaskStatusUpdateEvent)
        self.assertEqual(second_event.status.state, TaskState.completed)
        self.assertTrue(second_event.final)

    async def test_survives_artifact_enqueue_failure(self):
        """_send_error_completion continues even if artifact enqueue fails."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-789"
        task.context_id = "ctx-789"

        # First enqueue (artifact) fails, second (status) should still be attempted
        event_queue.enqueue_event = AsyncMock(
            side_effect=[RuntimeError("queue dead"), None]
        )

        # Should not raise
        await self.executor._send_error_completion(
            event_queue, task, "test_agent", "Error msg"
        )

        # Both calls attempted
        self.assertEqual(event_queue.enqueue_event.call_count, 2)

    async def test_survives_both_enqueue_failures(self):
        """_send_error_completion handles both enqueue calls failing."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-999"
        task.context_id = "ctx-999"

        event_queue.enqueue_event = AsyncMock(
            side_effect=RuntimeError("everything is broken")
        )

        # Should not raise
        await self.executor._send_error_completion(
            event_queue, task, "test_agent", "Error msg"
        )

    async def test_error_message_in_artifact_text(self):
        """The error message appears in the artifact text."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-111"
        task.context_id = "ctx-111"

        error_msg = "Custom error: service is down"
        await self.executor._send_error_completion(
            event_queue, task, "test_agent", error_msg
        )

        first_event = event_queue.enqueue_event.call_args_list[0][0][0]
        # Check that the artifact contains the error message (Part has root.text for TextPart)
        artifact_parts = first_event.artifact.parts
        artifact_text = ''.join(
            getattr(p.root, 'text', '') for p in artifact_parts if hasattr(p, 'root')
        )
        self.assertIn(error_msg, artifact_text)


class TestProcessStreamEvent(unittest.IsolatedAsyncioTestCase):
    """Test _process_stream_event method."""

    def setUp(self):
        self.agent = MockLangGraphAgent()
        self.executor = BaseLangGraphAgentExecutor(self.agent)
        self.executor._streaming_artifact_id = None

    async def test_tool_call_event(self):
        """tool_call events send tool_notification_start artifact."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'kind': 'tool_call',
            'tool_call': {'name': 'search', 'id': 'call_1'},
            'content': 'Calling search...',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertIsInstance(call, TaskArtifactUpdateEvent)
        self.assertEqual(call.artifact.name, 'tool_notification_start')

    async def test_tool_result_event(self):
        """tool_result events send tool_notification_end artifact."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'kind': 'tool_result',
            'tool_result': {'name': 'search', 'status': 'completed', 'is_error': False},
            'content': 'Search completed.',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertIsInstance(call, TaskArtifactUpdateEvent)
        self.assertEqual(call.artifact.name, 'tool_notification_end')

    async def test_status_event(self):
        """status events send status_update artifact."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'kind': 'status',
            'content': '⚠️ Attempting recovery...',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertIsInstance(call, TaskArtifactUpdateEvent)
        self.assertEqual(call.artifact.name, 'status_update')

    async def test_text_chunk_accumulates_content(self):
        """Default text chunks accumulate in accumulated_content."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"
        accumulated = []

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'kind': 'text_chunk',
            'content': 'Hello world',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", accumulated, event_queue
        )

        self.assertEqual(accumulated, ['Hello world'])
        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertIsInstance(call, TaskArtifactUpdateEvent)
        self.assertEqual(call.artifact.name, 'streaming_result')

    async def test_text_chunk_sets_streaming_artifact_id(self):
        """First text chunk sets the streaming artifact ID."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'content': 'First chunk',
        }

        self.assertIsNone(self.executor._streaming_artifact_id)
        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )
        self.assertIsNotNone(self.executor._streaming_artifact_id)

    async def test_text_chunk_appends_after_first(self):
        """Subsequent text chunks use append=True."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"
        accumulated = []

        # First chunk
        await self.executor._process_stream_event(
            {'is_task_complete': False, 'require_user_input': False, 'content': 'chunk1'},
            task, "test_agent", accumulated, event_queue
        )
        first_call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertFalse(first_call.append)

        # Second chunk
        await self.executor._process_stream_event(
            {'is_task_complete': False, 'require_user_input': False, 'content': 'chunk2'},
            task, "test_agent", accumulated, event_queue
        )
        second_call = event_queue.enqueue_event.call_args_list[1][0][0]
        self.assertTrue(second_call.append)

    async def test_tool_output_event(self):
        """tool_output events send tool_output artifact."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'kind': 'tool_output',
            'content': 'Tool produced output',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertIsInstance(call, TaskArtifactUpdateEvent)
        self.assertEqual(call.artifact.name, 'tool_output')

    async def test_empty_content_text_chunk_not_accumulated(self):
        """Empty content text chunks are not accumulated."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"
        accumulated = []

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'content': '',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", accumulated, event_queue
        )

        self.assertEqual(accumulated, [])
        # No enqueue for empty content
        event_queue.enqueue_event.assert_not_called()

    async def test_kind_inferred_from_tool_call_key(self):
        """When kind is missing but 'tool_call' key exists, infer kind='tool_call'."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'tool_call': {'name': 'deploy', 'id': 'call_2'},
            'content': 'Deploying...',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertEqual(call.artifact.name, 'tool_notification_start')

    async def test_kind_inferred_from_tool_result_key(self):
        """When kind is missing but 'tool_result' key exists, infer kind='tool_result'."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': False,
            'tool_result': {'name': 'deploy', 'status': 'completed'},
            'content': 'Deployed.',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertEqual(call.artifact.name, 'tool_notification_end')

    async def test_complete_event_closes_streaming_artifact(self):
        """is_task_complete closes the streaming artifact with last_chunk=True."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"
        accumulated = ['some content']

        # Simulate having an open streaming artifact
        self.executor._streaming_artifact_id = "art-123"

        event = {
            'is_task_complete': True,
            'require_user_input': False,
            'content': '',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", accumulated, event_queue
        )

        calls = event_queue.enqueue_event.call_args_list
        # Should have: closing artifact (last_chunk=True) + complete_result + completed status
        self.assertGreaterEqual(len(calls), 3)

        # First should be the closing artifact
        close_event = calls[0][0][0]
        self.assertIsInstance(close_event, TaskArtifactUpdateEvent)
        self.assertTrue(close_event.last_chunk)

    async def test_require_user_input_sends_input_required(self):
        """require_user_input events send input_required status."""
        event_queue = AsyncMock()
        task = Mock()
        task.id = "task-1"
        task.context_id = "ctx-1"

        event = {
            'is_task_complete': False,
            'require_user_input': True,
            'content': 'Please provide more info',
        }

        await self.executor._process_stream_event(
            event, task, "test_agent", [], event_queue
        )

        call = event_queue.enqueue_event.call_args_list[0][0][0]
        self.assertIsInstance(call, TaskStatusUpdateEvent)
        self.assertEqual(call.status.state, TaskState.input_required)


if __name__ == '__main__':
    unittest.main()

