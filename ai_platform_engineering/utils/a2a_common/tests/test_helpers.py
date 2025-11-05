# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for a2a_common helpers module."""

import unittest
from unittest.mock import Mock
from uuid import uuid4

from a2a.types import (
    Message,
    Part,
    Role,
    Task,
    TaskState,
    TaskStatus,
    TextPart,
)

from ai_platform_engineering.utils.a2a_common.helpers import (
    process_streaming_agent_response,
    update_task_with_agent_response,
)


class TestUpdateTaskWithAgentResponse(unittest.TestCase):
    """Test update_task_with_agent_response function."""

    def setUp(self):
        """Set up test fixtures."""
        self.task = Mock(spec=Task)
        self.task.status = Mock(spec=TaskStatus)
        self.task.history = []
        self.task.artifacts = []

    def test_update_task_with_user_input_required(self):
        """Test updating task when user input is required."""
        agent_response = {
            'content': 'Please provide more information',
            'require_user_input': True,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify task state was updated
        self.assertEqual(self.task.status.state, TaskState.input_required)

        # Verify timestamp was set
        self.assertIsNotNone(self.task.status.timestamp)

        # Verify message was created and added to history
        self.assertIsNotNone(self.task.status.message)
        self.assertEqual(len(self.task.history), 1)
        self.assertEqual(self.task.history[0].role, Role.agent)

    def test_update_task_when_history_is_none(self):
        """Test updating task when history is None."""
        self.task.history = None
        agent_response = {
            'content': 'Need input',
            'require_user_input': True,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify history was initialized
        self.assertEqual(len(self.task.history), 1)

    def test_update_task_with_completion(self):
        """Test updating task when completed."""
        agent_response = {
            'content': 'Task completed successfully',
            'require_user_input': False,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify task state was updated
        self.assertEqual(self.task.status.state, TaskState.completed)

        # Verify message is None for completed tasks
        self.assertIsNone(self.task.status.message)

        # Verify artifact was created
        self.assertEqual(len(self.task.artifacts), 1)
        self.assertIsNotNone(self.task.artifacts[0].artifact_id)

    def test_update_task_when_artifacts_is_none(self):
        """Test updating task when artifacts is None."""
        self.task.artifacts = None
        agent_response = {
            'content': 'Done',
            'require_user_input': False,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify artifacts was initialized
        self.assertEqual(len(self.task.artifacts), 1)

    def test_update_task_preserves_existing_history(self):
        """Test that existing history is preserved."""
        existing_message = Mock(spec=Message)
        self.task.history = [existing_message]

        agent_response = {
            'content': 'Need more info',
            'require_user_input': True,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify history contains both old and new messages
        self.assertEqual(len(self.task.history), 2)
        self.assertEqual(self.task.history[0], existing_message)

    def test_update_task_preserves_existing_artifacts(self):
        """Test that existing artifacts are preserved."""
        existing_artifact = Mock()
        self.task.artifacts = [existing_artifact]

        agent_response = {
            'content': 'Completed',
            'require_user_input': False,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify artifacts contains both old and new
        self.assertEqual(len(self.task.artifacts), 2)
        self.assertEqual(self.task.artifacts[0], existing_artifact)

    def test_update_task_with_empty_content(self):
        """Test updating task with empty content."""
        agent_response = {
            'content': '',
            'require_user_input': False,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Should still create artifact with empty content
        self.assertEqual(len(self.task.artifacts), 1)
        self.assertEqual(self.task.status.state, TaskState.completed)

    def test_update_task_creates_valid_parts(self):
        """Test that parts are created correctly."""
        agent_response = {
            'content': 'Test content',
            'require_user_input': False,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify artifact has correct parts structure
        artifact = self.task.artifacts[0]
        self.assertEqual(len(artifact.parts), 1)
        self.assertIsInstance(artifact.parts[0], Part)
        self.assertIsInstance(artifact.parts[0].root, TextPart)
        self.assertEqual(artifact.parts[0].root.text, 'Test content')


class TestProcessStreamingAgentResponse(unittest.TestCase):
    """Test process_streaming_agent_response function."""

    def setUp(self):
        """Set up test fixtures."""
        self.task = Mock(spec=Task)
        self.task.id = str(uuid4())
        self.task.context_id = str(uuid4())

    def test_process_response_working_state(self):
        """Test processing response in working state."""
        agent_response = {
            'content': 'Processing...',
            'is_task_complete': False,
            'require_user_input': False,
        }

        artifact_event, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Should not create artifact for working state
        self.assertIsNone(artifact_event)

        # Should create status event
        self.assertIsNotNone(status_event)
        self.assertEqual(status_event.status.state, TaskState.working)
        self.assertIsNotNone(status_event.status.message)
        self.assertFalse(status_event.final)

    def test_process_response_input_required(self):
        """Test processing response when input is required."""
        agent_response = {
            'content': 'Need more information',
            'is_task_complete': False,
            'require_user_input': True,
        }

        artifact_event, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Should not create artifact for input_required state
        self.assertIsNone(artifact_event)

        # Should create status event
        self.assertIsNotNone(status_event)
        self.assertEqual(status_event.status.state, TaskState.input_required)
        self.assertIsNotNone(status_event.status.message)
        self.assertTrue(status_event.final)  # Should end stream

    def test_process_response_completed(self):
        """Test processing response when task is completed."""
        agent_response = {
            'content': 'Task completed',
            'is_task_complete': True,
            'require_user_input': False,
        }

        artifact_event, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Should create artifact for completed state
        self.assertIsNotNone(artifact_event)
        self.assertEqual(artifact_event.task_id, self.task.id)
        self.assertEqual(artifact_event.context_id, self.task.context_id)
        self.assertIsNotNone(artifact_event.artifact)
        self.assertFalse(artifact_event.append)
        self.assertTrue(artifact_event.last_chunk)

        # Should create status event
        self.assertIsNotNone(status_event)
        self.assertEqual(status_event.status.state, TaskState.completed)
        self.assertIsNone(status_event.status.message)  # No message for completed
        self.assertTrue(status_event.final)

    def test_process_response_creates_correct_artifact(self):
        """Test that artifact is created with correct structure."""
        agent_response = {
            'content': 'Final result',
            'is_task_complete': True,
            'require_user_input': False,
        }

        artifact_event, _ = process_streaming_agent_response(
            self.task, agent_response
        )

        # Verify artifact structure
        artifact = artifact_event.artifact
        self.assertIsNotNone(artifact.artifact_id)
        self.assertEqual(len(artifact.parts), 1)
        self.assertIsInstance(artifact.parts[0], Part)
        self.assertIsInstance(artifact.parts[0].root, TextPart)
        self.assertEqual(artifact.parts[0].root.text, 'Final result')

    def test_process_response_creates_correct_message(self):
        """Test that message is created with correct structure for working state."""
        agent_response = {
            'content': 'Working on it...',
            'is_task_complete': False,
            'require_user_input': False,
        }

        _, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Verify message structure
        message = status_event.status.message
        self.assertIsNotNone(message)
        self.assertIsNotNone(message.message_id)
        self.assertEqual(message.role, Role.agent)
        self.assertEqual(len(message.parts), 1)

    def test_process_response_with_empty_content(self):
        """Test processing response with empty content."""
        agent_response = {
            'content': '',
            'is_task_complete': True,
            'require_user_input': False,
        }

        artifact_event, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Should still create artifact even with empty content
        self.assertIsNotNone(artifact_event)
        self.assertEqual(artifact_event.artifact.parts[0].root.text, '')

    def test_process_response_status_has_timestamp(self):
        """Test that status event has timestamp."""
        agent_response = {
            'content': 'Test',
            'is_task_complete': False,
            'require_user_input': False,
        }

        _, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Verify timestamp is set
        self.assertIsNotNone(status_event.status.timestamp)

    def test_process_response_preserves_task_ids(self):
        """Test that task and context IDs are preserved in events."""
        agent_response = {
            'content': 'Test',
            'is_task_complete': True,
            'require_user_input': False,
        }

        artifact_event, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Verify IDs are correct in both events
        self.assertEqual(artifact_event.task_id, self.task.id)
        self.assertEqual(artifact_event.context_id, self.task.context_id)
        self.assertEqual(status_event.task_id, self.task.id)
        self.assertEqual(status_event.context_id, self.task.context_id)

    def test_process_response_final_flag_combinations(self):
        """Test final flag is set correctly for different combinations."""
        # Working state: not final
        response1 = {
            'content': 'Working',
            'is_task_complete': False,
            'require_user_input': False,
        }
        _, status1 = process_streaming_agent_response(self.task, response1)
        self.assertFalse(status1.final)

        # Input required: final
        response2 = {
            'content': 'Need input',
            'is_task_complete': False,
            'require_user_input': True,
        }
        _, status2 = process_streaming_agent_response(self.task, response2)
        self.assertTrue(status2.final)

        # Completed: final
        response3 = {
            'content': 'Done',
            'is_task_complete': True,
            'require_user_input': False,
        }
        _, status3 = process_streaming_agent_response(self.task, response3)
        self.assertTrue(status3.final)


class TestHelpersSnakeCaseCompliance(unittest.TestCase):
    """Test that helpers module uses snake_case for A2A SDK 0.3.0+ compliance."""

    def setUp(self):
        """Set up test fixtures."""
        self.task = Mock(spec=Task)
        self.task.id = "test-task-id"
        self.task.context_id = "test-context-id"
        self.task.status = Mock(spec=TaskStatus)
        self.task.history = []
        self.task.artifacts = []

    def test_artifact_event_uses_snake_case_fields(self):
        """Test that TaskArtifactUpdateEvent uses snake_case fields."""
        agent_response = {
            'content': 'Done',
            'is_task_complete': True,
            'require_user_input': False,
        }

        artifact_event, _ = process_streaming_agent_response(
            self.task, agent_response
        )

        # Verify snake_case fields exist and are accessible
        self.assertEqual(artifact_event.task_id, "test-task-id")
        self.assertEqual(artifact_event.context_id, "test-context-id")
        self.assertIsNotNone(artifact_event.artifact.artifact_id)
        self.assertTrue(artifact_event.last_chunk)

    def test_status_event_uses_snake_case_fields(self):
        """Test that TaskStatusUpdateEvent uses snake_case fields."""
        agent_response = {
            'content': 'Working',
            'is_task_complete': False,
            'require_user_input': False,
        }

        _, status_event = process_streaming_agent_response(
            self.task, agent_response
        )

        # Verify snake_case fields exist and are accessible
        self.assertEqual(status_event.task_id, "test-task-id")
        self.assertEqual(status_event.context_id, "test-context-id")

    def test_message_uses_snake_case_fields(self):
        """Test that Message uses snake_case fields."""
        agent_response = {
            'content': 'Test message',
            'require_user_input': True,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify message uses snake_case
        message = self.task.status.message
        self.assertIsNotNone(message.message_id)

    def test_artifact_uses_snake_case_fields(self):
        """Test that Artifact uses snake_case fields."""
        agent_response = {
            'content': 'Completed',
            'require_user_input': False,
        }

        update_task_with_agent_response(self.task, agent_response)

        # Verify artifact uses snake_case
        artifact = self.task.artifacts[0]
        self.assertIsNotNone(artifact.artifact_id)


if __name__ == '__main__':
    unittest.main()


