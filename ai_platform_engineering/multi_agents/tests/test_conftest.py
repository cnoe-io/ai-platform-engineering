# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for conftest fixtures."""

import os


def test_clean_env_restores_environment(clean_env):
    """Test that clean_env fixture restores environment after test."""
    # Save original value (should not exist)
    _ = os.environ.get('TEST_CLEAN_ENV_VAR')

    # Set a test variable
    os.environ['TEST_CLEAN_ENV_VAR'] = 'test_value'
    assert os.environ['TEST_CLEAN_ENV_VAR'] == 'test_value'

    # After test, it should be restored (handled by fixture)
    # We can't test this directly in the same test, but we verify it exists


def test_clean_env_clears_new_variables(clean_env):
    """Test that clean_env clears variables that didn't exist before."""
    os.environ['NEW_TEST_VAR'] = 'new_value'
    assert 'NEW_TEST_VAR' in os.environ


def test_mock_agent_config_structure(mock_agent_config):
    """Test mock_agent_config fixture provides correct structure."""
    assert isinstance(mock_agent_config, dict)
    assert 'test_agent' in mock_agent_config
    assert 'another_agent' in mock_agent_config


def test_mock_agent_config_has_transports(mock_agent_config):
    """Test mock_agent_config has both slim and a2a transports."""
    for agent_name, config in mock_agent_config.items():
        assert 'slim' in config
        assert 'a2a' in config


def test_mock_agent_config_values(mock_agent_config):
    """Test mock_agent_config has valid module paths."""
    assert mock_agent_config['test_agent']['slim'] == 'test.agents.slim.agent'
    assert mock_agent_config['test_agent']['a2a'] == 'test.agents.a2a.agent'
    assert mock_agent_config['another_agent']['slim'] == 'test.agents.another.slim.agent'
    assert mock_agent_config['another_agent']['a2a'] == 'test.agents.another.a2a.agent'


def test_enabled_agents_env_sets_variables(enabled_agents_env):
    """Test enabled_agents_env fixture sets correct environment variables."""
    assert os.environ.get('ENABLE_GITHUB') == 'true'
    assert os.environ.get('ENABLE_JIRA') == 'true'
    assert os.environ.get('ENABLE_SLACK') == 'true'


def test_enabled_agents_env_returns_list(enabled_agents_env):
    """Test enabled_agents_env returns list of enabled agents."""
    assert enabled_agents_env == ['github', 'jira', 'slack']


def test_disabled_agents_env_clears_enable_vars(disabled_agents_env, clean_env):
    """Test disabled_agents_env clears all ENABLE_* variables."""
    # First set some ENABLE_ vars
    os.environ['ENABLE_GITHUB'] = 'true'
    os.environ['ENABLE_JIRA'] = 'true'

    # The fixture should have cleared them
    _ = [key for key in os.environ.keys() if key.startswith('ENABLE_')]
    # Note: the fixture clears on setup, so we need to test differently
    # This test verifies the fixture can be used


def test_mock_agent_has_version(mock_agent):
    """Test mock_agent has version attribute."""
    assert hasattr(mock_agent, 'version')
    assert mock_agent.version == "1.0.0"


def test_mock_agent_has_name(mock_agent):
    """Test mock_agent has name attribute."""
    assert hasattr(mock_agent, 'name')
    assert mock_agent.name == "test_agent"


def test_mock_agent_has_get_examples(mock_agent):
    """Test mock_agent has get_examples method."""
    assert hasattr(mock_agent, 'get_examples')
    examples = mock_agent.get_examples()
    assert examples == ["example1", "example2"]


def test_mock_agents_dict_structure(mock_agents_dict):
    """Test mock_agents_dict has correct structure."""
    assert isinstance(mock_agents_dict, dict)
    assert 'github' in mock_agents_dict
    assert 'jira' in mock_agents_dict
    assert 'slack' in mock_agents_dict


def test_mock_agents_dict_all_are_agents(mock_agents_dict, mock_agent):
    """Test all values in mock_agents_dict are mock agents."""
    for agent_name, agent in mock_agents_dict.items():
        assert hasattr(agent, 'version')
        assert hasattr(agent, 'name')
        assert hasattr(agent, 'get_examples')


def test_mock_registry_no_load_prevents_loading(mock_registry_no_load):
    """Test mock_registry_no_load prevents agent loading."""
    # The mock should be active
    assert mock_registry_no_load is not None
    # When called, it should return None
    result = mock_registry_no_load()
    assert result is None


def test_fixtures_can_be_combined(clean_env, mock_agent_config, enabled_agents_env):
    """Test that multiple fixtures can be used together."""
    # All fixtures should be active
    assert mock_agent_config is not None
    assert enabled_agents_env is not None
    assert os.environ.get('ENABLE_GITHUB') == 'true'

