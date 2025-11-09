# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Pytest configuration and shared fixtures for A2A protocol binding tests.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock


@pytest.fixture
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_a2a_message():
    """Create a mock A2A message."""
    message = Mock()
    message.context_id = "test-context-id"
    message.message_id = "test-message-id"
    message.role = "user"
    mock_part = Mock()
    mock_part.root = Mock()
    mock_part.root.text = "test query"
    message.parts = [mock_part]
    return message


@pytest.fixture
def mock_a2a_task():
    """Create a mock A2A task."""
    task = Mock()
    task.id = "test-task-id"
    task.context_id = "test-context-id"
    task.status = Mock()
    task.status.state = "submitted"
    return task


@pytest.fixture
def mock_event_queue():
    """Create a mock event queue."""
    queue = Mock()
    queue.enqueue_event = AsyncMock()
    queue.is_closed = False
    return queue


@pytest.fixture
def mock_request_context(mock_a2a_message, mock_a2a_task):
    """Create a mock request context."""
    context = Mock()
    context.message = mock_a2a_message
    context.current_task = mock_a2a_task
    context.get_user_input = Mock(return_value="test query")
    return context


