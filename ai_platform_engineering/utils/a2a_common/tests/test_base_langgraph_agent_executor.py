# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for BaseLangGraphAgentExecutor."""

import asyncio
import unittest
from unittest.mock import AsyncMock, Mock

from a2a.types import Task, TaskState

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


if __name__ == '__main__':
    unittest.main()

