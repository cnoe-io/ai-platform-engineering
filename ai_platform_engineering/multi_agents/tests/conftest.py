# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Pytest configuration and shared fixtures for multi-agents tests.
"""

import pytest
import os
from typing import Dict
from unittest.mock import Mock, patch


@pytest.fixture
def clean_env():
    """
    Fixture that saves and restores environment variables.

    Usage:
        def test_something(clean_env):
            os.environ['SOME_VAR'] = 'value'
            # ... test code ...
            # Environment is automatically restored after test
    """
    original_env = os.environ.copy()
    yield
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture
def mock_agent_config():
    """
    Fixture providing a mock agent configuration for testing.

    Returns:
        dict: A minimal agent configuration for testing
    """
    return {
        "test_agent": {
            "slim": "test.agents.slim.agent",
            "a2a": "test.agents.a2a.agent"
        },
        "another_agent": {
            "slim": "test.agents.another.slim.agent",
            "a2a": "test.agents.another.a2a.agent"
        }
    }


@pytest.fixture
def mock_registry_no_load():
    """
    Fixture providing a patched AgentRegistry that doesn't load agents.

    This prevents actual agent loading during tests and allows focusing
    on the registry logic itself.
    """
    with patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents') as mock_load:
        mock_load.return_value = None
        yield mock_load


@pytest.fixture
def enabled_agents_env(clean_env):
    """
    Fixture that sets up environment with some agents enabled.

    Enables: github, jira, slack
    """
    os.environ['ENABLE_GITHUB'] = 'true'
    os.environ['ENABLE_JIRA'] = 'true'
    os.environ['ENABLE_SLACK'] = 'true'
    yield ['github', 'jira', 'slack']


@pytest.fixture
def disabled_agents_env(clean_env):
    """
    Fixture that sets up environment with all agents disabled.
    """
    # Clear all ENABLE_* variables
    for key in list(os.environ.keys()):
        if key.startswith('ENABLE_'):
            del os.environ[key]
    yield


@pytest.fixture
def mock_agent():
    """
    Fixture providing a mock agent object.

    Returns:
        Mock: A mock agent with common attributes
    """
    agent = Mock()
    agent.version = "1.0.0"
    agent.name = "test_agent"
    agent.get_examples.return_value = ["example1", "example2"]
    return agent


@pytest.fixture
def mock_agents_dict(mock_agent):
    """
    Fixture providing a dictionary of mock agents.

    Returns:
        dict: Dictionary with agent_name: mock_agent pairs
    """
    return {
        'github': mock_agent,
        'jira': mock_agent,
        'slack': mock_agent,
    }


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as integration test"
    )
    config.addinivalue_line(
        "markers", "unit: mark test as unit test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )

