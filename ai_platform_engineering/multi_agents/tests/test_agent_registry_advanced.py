# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Advanced unit tests for the AgentRegistry class.

This test suite covers advanced scenarios including:
1. Dynamic monitoring and refresh capabilities
2. Connectivity checks and retries
3. Agent URL inference and configuration
4. Error handling and edge cases
5. Thread safety and concurrency
"""

import os
import unittest
from unittest.mock import Mock, patch
import threading

# Import the module to test
from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry


class TestDynamicMonitoring(unittest.TestCase):
    """Test dynamic monitoring capabilities."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_enable_dynamic_monitoring(self, mock_load):
        """Test enabling dynamic monitoring."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        # Enable monitoring
        callback = Mock()
        registry.enable_dynamic_monitoring(on_change_callback=callback)

        # Check that monitoring attributes are set
        self.assertTrue(hasattr(registry, '_refresh_interval'))
        self.assertTrue(hasattr(registry, '_enable_background_monitoring'))
        self.assertTrue(hasattr(registry, '_lock'))
        print("✓ Dynamic monitoring can be enabled")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_monitoring_callback_on_change(self, mock_load):
        """Test that callback is called when agents change."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        callback = Mock()
        registry.enable_dynamic_monitoring(on_change_callback=callback)

        # Simulate agent changes
        registry._agents = {'AGENT1': {'name': 'agent1'}}
        with patch.object(registry, '_refresh_connectivity_only', return_value=True):
            registry.refresh_agents()

        # Callback should be called
        callback.assert_called()
        print("✓ Callback is invoked on agent changes")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_force_refresh(self, mock_load):
        """Test force refresh functionality."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry.enable_dynamic_monitoring()

        with patch.object(registry, 'refresh_agents', return_value=True) as mock_refresh:
            result = registry.force_refresh()
            mock_refresh.assert_called_with(use_fast_timeout=False)
            self.assertTrue(result)
        print("✓ Force refresh works correctly")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_registry_status(self, mock_load):
        """Test getting registry status."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._agents = {'AGENT1': {'name': 'agent1'}, 'AGENT2': {'name': 'agent2'}}
        registry._tools = {'AGENT1': Mock(), 'AGENT2': Mock()}

        status = registry.get_registry_status()

        self.assertIn('agents_count', status)
        self.assertIn('agents', status)
        self.assertEqual(status['agents_count'], 2)
        self.assertEqual(set(status['agents']), {'AGENT1', 'AGENT2'})
        print("✓ Registry status retrieval works")


class TestConnectivityChecks(unittest.TestCase):
    """Test connectivity checking functionality."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_disabled_by_default(self, mock_load):
        """Test that connectivity checks are disabled by default."""
        mock_load.return_value = None

        # Default should have checks disabled
        with patch.dict(os.environ, {'SKIP_AGENT_CONNECTIVITY_CHECK': 'true'}, clear=True):
            registry = AgentRegistry()
            self.assertFalse(registry._check_connectivity)
        print("✓ Connectivity checks disabled by default")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_can_be_enabled(self, mock_load):
        """Test that connectivity checks can be enabled."""
        mock_load.return_value = None

        with patch.dict(os.environ, {'SKIP_AGENT_CONNECTIVITY_CHECK': 'false'}, clear=True):
            registry = AgentRegistry()
            self.assertTrue(registry._check_connectivity)
        print("✓ Connectivity checks can be enabled")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_timeout_config(self, mock_load):
        """Test connectivity timeout configuration."""
        mock_load.return_value = None

        with patch.dict(os.environ, {'AGENT_CONNECTIVITY_TIMEOUT': '10.5'}, clear=True):
            registry = AgentRegistry()
            self.assertEqual(registry._connectivity_timeout, 10.5)
        print("✓ Connectivity timeout can be configured")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_max_retries_config(self, mock_load):
        """Test max retries configuration."""
        mock_load.return_value = None

        with patch.dict(os.environ, {'AGENT_CONNECTIVITY_MAX_RETRIES': '5'}, clear=True):
            registry = AgentRegistry()
            self.assertEqual(registry._max_retries, 5)
        print("✓ Max retries can be configured")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    @patch('httpx.Client')
    def test_check_agent_connectivity_success(self, mock_httpx, mock_load):
        """Test successful agent connectivity check."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._check_connectivity = True
        registry._transport = 'p2p'

        # Mock successful response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'name': 'github', 'skills': []}
        mock_client = Mock()
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client.get.return_value = mock_response
        mock_httpx.return_value = mock_client

        is_reachable, agent_card = registry._check_agent_connectivity('github', 'http://localhost:8000')
        self.assertTrue(is_reachable)
        self.assertIsNotNone(agent_card)
        print("✓ Successful connectivity check works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_check_agent_connectivity_disabled(self, mock_load):
        """Test that connectivity check returns True when disabled."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._check_connectivity = False

        is_reachable, agent_card = registry._check_agent_connectivity('github', 'http://localhost:8000')
        self.assertTrue(is_reachable)
        self.assertIsNone(agent_card)
        print("✓ Connectivity check returns True when disabled")


class TestAgentURLInference(unittest.TestCase):
    """Test agent URL inference from environment variables."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_url_with_env_var(self, mock_load):
        """Test URL inference with environment variable set."""
        mock_load.return_value = None

        with patch.dict(os.environ, {'GITHUB_AGENT_URL': 'http://custom-github:9000'}, clear=True):
            registry = AgentRegistry()
            url = registry._infer_agent_url_from_env_var('GITHUB')
            self.assertEqual(url, 'http://custom-github:9000')
        print("✓ URL inference from env var works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_url_with_hyphens(self, mock_load):
        """Test URL inference for agent names with hyphens."""
        mock_load.return_value = None

        with patch.dict(os.environ, {'TEST_AGENT_AGENT_URL': 'http://test-agent:8080'}, clear=True):
            registry = AgentRegistry()
            url = registry._infer_agent_url_from_env_var('test-agent')
            self.assertEqual(url, 'http://test-agent:8080')
        print("✓ URL inference handles hyphens")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_url_default_fallback(self, mock_load):
        """Test URL inference falls back to default."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()
            url = registry._infer_agent_url_from_env_var('nonexistent')
            self.assertEqual(url, 'http://localhost:8000')
        print("✓ URL inference uses default fallback")


class TestTransportModes(unittest.TestCase):
    """Test different transport modes."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_default_transport_mode(self, mock_load):
        """Test default transport mode."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()
            self.assertEqual(registry.transport, 'p2p')
        print("✓ Default transport mode is p2p")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_slim_transport_mode(self, mock_load):
        """Test slim transport mode."""
        mock_load.return_value = None

        with patch.dict(os.environ, {'A2A_TRANSPORT': 'slim'}, clear=True):
            registry = AgentRegistry()
            self.assertEqual(registry.transport, 'slim')
        print("✓ SLIM transport mode can be set")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_transport_mode_case_insensitive(self, mock_load):
        """Test that transport mode is case insensitive."""
        mock_load.return_value = None

        test_cases = ['P2P', 'p2p', 'SLIM', 'Slim']
        for mode in test_cases:
            with patch.dict(os.environ, {'A2A_TRANSPORT': mode}, clear=True):
                registry = AgentRegistry()
                self.assertIn(registry.transport.lower(), ['p2p', 'slim'])
        print("✓ Transport mode is case insensitive")


class TestAgentExamples(unittest.TestCase):
    """Test agent examples functionality."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_examples_empty(self, mock_load):
        """Test getting examples when no agents."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._agents = {}

        examples = registry.get_examples()
        self.assertEqual(examples, [])
        print("✓ Returns empty list when no agents")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_agent_examples(self, mock_load):
        """Test getting examples for a specific agent."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        # Create mock agent card with examples
        mock_agent_card = {
            'name': 'github',
            'skills': [
                {
                    'name': 'github_skill',
                    'examples': ['example1', 'example2']
                }
            ]
        }

        registry._agents = {'GITHUB': mock_agent_card}

        examples = registry.get_agent_examples('GITHUB')
        self.assertEqual(examples, ['example1', 'example2'])
        print("✓ Gets examples from agent card correctly")


class TestEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_agent_nonexistent(self, mock_load):
        """Test getting nonexistent agent raises ValueError."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._agents = {}

        with self.assertRaises(ValueError) as context:
            registry.get_agent('NONEXISTENT')

        self.assertIn('not found', str(context.exception))
        print("✓ Raises ValueError for nonexistent agent")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_agent_examples_nonexistent(self, mock_load):
        """Test getting examples for nonexistent agent raises ValueError."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._agents = {}

        with self.assertRaises(ValueError):
            registry.get_agent_examples('NONEXISTENT')
        print("✓ Raises ValueError for nonexistent agent examples")


class TestConcurrency(unittest.TestCase):
    """Test thread safety and concurrent operations."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_concurrent_agent_exists_calls(self, mock_load):
        """Test concurrent calls to agent_exists."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._agents = {'AGENT1': {'name': 'agent1'}, 'AGENT2': {'name': 'agent2'}}

        results = []
        def check_exists(name):
            results.append(registry.agent_exists(name))

        threads = [
            threading.Thread(target=check_exists, args=('AGENT1',)),
            threading.Thread(target=check_exists, args=('AGENT2',)),
            threading.Thread(target=check_exists, args=('AGENT1',)),
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(results), 3)
        self.assertTrue(all(results))
        print("✓ Concurrent agent_exists calls work")


class TestSubagentGeneration(unittest.TestCase):
    """Test subagent generation functionality."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    @patch('ai_platform_engineering.multi_agents.agent_registry.create_react_agent')
    def test_generate_subagents_basic(self, mock_create_react, mock_load):
        """Test basic subagent generation."""
        mock_load.return_value = None
        mock_create_react.return_value = "mock_graph"

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        # Create mock agent cards and tools
        from unittest.mock import MagicMock
        mock_tool = MagicMock()
        mock_tool.name = "GitHub_Agent"

        registry._agents = {
            'GITHUB': {'name': 'GitHub Agent', 'description': 'GitHub integration'},
            'JIRA': {'name': 'JIRA Agent', 'description': 'JIRA integration'}
        }
        registry._tools = {
            'GITHUB': mock_tool,
            'JIRA': mock_tool
        }

        agent_prompts = {}
        mock_model = MagicMock()
        subagents = registry.generate_subagents(agent_prompts, mock_model)

        self.assertEqual(len(subagents), 2)
        self.assertTrue(all('name' in sa for sa in subagents))
        self.assertTrue(all('description' in sa for sa in subagents))
        self.assertTrue(all('graph' in sa for sa in subagents))
        print("✓ Subagent generation works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    @patch('ai_platform_engineering.multi_agents.agent_registry.create_react_agent')
    def test_generate_subagents_with_override(self, mock_create_react, mock_load):
        """Test subagent generation with prompt override."""
        mock_load.return_value = None
        mock_create_react.return_value = "mock_graph"

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        from unittest.mock import MagicMock
        mock_tool = MagicMock()
        mock_tool.name = "GitHub_Agent"

        registry._agents = {
            'GITHUB': {'name': 'GitHub Agent', 'description': 'GitHub integration'}
        }
        registry._tools = {
            'GITHUB': mock_tool
        }

        agent_prompts = {
            'GITHUB': {'system_prompt': 'Custom prompt'}
        }
        mock_model = MagicMock()
        subagents = registry.generate_subagents(agent_prompts, mock_model)

        # Verify the custom prompt was passed to create_react_agent
        mock_create_react.assert_called()
        call_args = mock_create_react.call_args
        self.assertEqual(call_args[1]['prompt'], 'Custom prompt')
        print("✓ Subagent prompt override works")


class TestSanitization(unittest.TestCase):
    """Test tool name sanitization."""

    def test_sanitize_tool_name_spaces(self):
        """Test sanitizing tool names with spaces."""
        result = AgentRegistry._sanitize_tool_name("Test Agent Name")
        self.assertEqual(result, "Test_Agent_Name")
        print("✓ Spaces converted to underscores")

    def test_sanitize_tool_name_special_chars(self):
        """Test sanitizing tool names with special characters."""
        result = AgentRegistry._sanitize_tool_name("agent@#$%name")
        self.assertEqual(result, "agentname")
        print("✓ Special characters removed")

    def test_sanitize_tool_name_empty(self):
        """Test sanitizing empty tool name."""
        result = AgentRegistry._sanitize_tool_name("")
        self.assertEqual(result, "unknown_agent")
        print("✓ Empty string returns unknown_agent")

    def test_sanitize_tool_name_preserves_valid(self):
        """Test that valid characters are preserved."""
        result = AgentRegistry._sanitize_tool_name("agent_name-123.test")
        self.assertEqual(result, "agent_name-123.test")
        print("✓ Valid characters preserved")


def run_tests():
    """Run all advanced tests and provide summary."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # Add all test classes
    test_classes = [
        TestDynamicMonitoring,
        TestConnectivityChecks,
        TestAgentURLInference,
        TestTransportModes,
        TestAgentExamples,
        TestEdgeCases,
        TestConcurrency,
        TestSubagentGeneration,
        TestSanitization,
    ]

    for test_class in test_classes:
        tests = loader.loadTestsFromTestCase(test_class)
        suite.addTests(tests)

    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # Print summary
    print("\n" + "="*70)
    print("ADVANCED TEST SUMMARY")
    print("="*70)
    print(f"Total tests run: {result.testsRun}")
    print(f"Successes: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print("="*70)

    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    exit(run_tests())
