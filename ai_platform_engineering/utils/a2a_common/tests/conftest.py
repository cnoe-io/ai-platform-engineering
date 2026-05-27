# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Pytest configuration and fixtures for A2A base class tests."""

import pytest
from unittest.mock import Mock, MagicMock


@pytest.fixture
def mock_mcp_client():
    """Create a mock MCP client."""
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)

    # Create tools with proper name attributes
    tool1 = Mock()
    tool1.name = "tool1"
    tool1.tool_name = "tool1"

    tool2 = Mock()
    tool2.name = "tool2"
    tool2.tool_name = "tool2"

    tool3 = Mock()
    tool3.name = "tool3"
    tool3.tool_name = "tool3"

    client.list_tools_sync = Mock(return_value=[tool1, tool2, tool3])
    return client


@pytest.fixture
def mock_strands_agent():
    """Create a mock Strands agent."""
    agent = Mock()
    agent.stream_async = Mock(return_value=[
        {"data": "Hello "},
        {"data": "world!"}
    ])
    agent.__call__ = Mock(return_value="Hello world!")
    return agent


@pytest.fixture
def mock_agent_config():
    """Create a mock agent configuration."""
    config = Mock()
    config.log_level = "INFO"
    config.model_provider = "openai"
    config.model_name = "gpt-4"
    return config


@pytest.fixture
def mock_a2a_context():
    """Create a mock A2A context."""
    context = Mock()
    task = Mock()
    task.id = "test-task-123"
    task.instruction = "Test query"
    context.current_task = task
    return context


@pytest.fixture
async def mock_a2a_event_queue():
    """Create a mock A2A event queue."""
    queue = MagicMock()
    queue.put = MagicMock()
    return queue


@pytest.fixture
def sample_tools():
    """Create sample tools for testing."""
    tool1 = Mock()
    tool1.name = "list_clusters"
    tool1.tool_name = "list_clusters"

    tool2 = Mock()
    tool2.name = "create_cluster"
    tool2.tool_name = "create_cluster"

    tool3 = Mock()
    tool3.name = "delete_cluster"
    tool3.tool_name = "delete_cluster"

    return [tool1, tool2, tool3]

