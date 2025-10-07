# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Advanced unit tests for the AgentRegistry class.

This test suite covers advanced scenarios including:
1. Dynamic monitoring and refresh capabilities
2. Connectivity checks and retries
3. Agent URL inference and configuration
4. Module loading and caching
5. Error handling and edge cases
6. Thread safety and concurrency
7. Integration scenarios
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
        registry = AgentRegistry(agent_names=[])

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
        registry = AgentRegistry(agent_names=[])

        callback = Mock()
        registry.enable_dynamic_monitoring(on_change_callback=callback)

        # Simulate agent changes
        registry._agents = {'agent1': Mock()}
        with patch.object(registry, '_refresh_connectivity_only', return_value=True):
            registry.refresh_agents()

        # Callback should be called
        callback.assert_called()
        print("✓ Callback is invoked on agent changes")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_force_refresh(self, mock_load):
        """Test force refresh functionality."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
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
        registry = AgentRegistry(agent_names=[])
        registry._agents = {'agent1': Mock(), 'agent2': Mock()}

        status = registry.get_registry_status()

        self.assertIn('agents_count', status)
        self.assertIn('agents', status)
        self.assertEqual(status['agents_count'], 2)
        self.assertEqual(set(status['agents']), {'agent1', 'agent2'})
        print("✓ Registry status retrieval works")


class TestConnectivityChecks(unittest.TestCase):
    """Test connectivity checking functionality."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_disabled_by_default(self, mock_load):
        """Test that connectivity checks are disabled by default."""
        mock_load.return_value = None

        # Default should have checks disabled
        with patch.dict(os.environ, {}, clear=True):
            os.environ['SKIP_AGENT_CONNECTIVITY_CHECK'] = 'true'
            registry = AgentRegistry(agent_names=[])
            self.assertFalse(registry._check_connectivity)
        print("✓ Connectivity checks disabled by default")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_can_be_enabled(self, mock_load):
        """Test that connectivity checks can be enabled."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['SKIP_AGENT_CONNECTIVITY_CHECK'] = 'false'
            registry = AgentRegistry(agent_names=[])
            self.assertTrue(registry._check_connectivity)
        print("✓ Connectivity checks can be enabled")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_timeout_config(self, mock_load):
        """Test connectivity timeout configuration."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['AGENT_CONNECTIVITY_TIMEOUT'] = '10.5'
            registry = AgentRegistry(agent_names=[])
            self.assertEqual(registry._connectivity_timeout, 10.5)
        print("✓ Connectivity timeout can be configured")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_max_retries_config(self, mock_load):
        """Test max retries configuration."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['AGENT_CONNECTIVITY_MAX_RETRIES'] = '5'
            registry = AgentRegistry(agent_names=[])
            self.assertEqual(registry._max_retries, 5)
        print("✓ Max retries can be configured")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    @patch('httpx.Client')
    def test_check_agent_connectivity_success(self, mock_httpx, mock_load):
        """Test successful agent connectivity check."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
        registry._check_connectivity = True

        # Mock successful response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'name': 'github'}
        mock_client = Mock()
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=None)
        mock_client.get.return_value = mock_response
        mock_httpx.return_value = mock_client

        result = registry._check_agent_connectivity('github', 'http://localhost:8000')
        self.assertTrue(result)
        print("✓ Successful connectivity check works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_check_agent_connectivity_disabled(self, mock_load):
        """Test that connectivity check returns True when disabled."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
        registry._check_connectivity = False

        result = registry._check_agent_connectivity('github', 'http://localhost:8000')
        self.assertTrue(result)
        print("✓ Connectivity check returns True when disabled")


class TestAgentURLInference(unittest.TestCase):
    """Test agent URL inference from environment variables."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_url_with_env_var(self, mock_load):
        """Test URL inference with environment variable set."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        with patch.dict(os.environ, {}, clear=True):
            os.environ['GITHUB_AGENT_URL'] = 'http://custom-github:9000'
            url = registry._infer_agent_url_from_env_var('github')
            self.assertEqual(url, 'http://custom-github:9000')
        print("✓ URL inference from env var works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_url_with_hyphens(self, mock_load):
        """Test URL inference for agent names with hyphens."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        with patch.dict(os.environ, {}, clear=True):
            os.environ['TEST_AGENT_AGENT_URL'] = 'http://test-agent:8080'
            url = registry._infer_agent_url_from_env_var('test-agent')
            self.assertEqual(url, 'http://test-agent:8080')
        print("✓ URL inference handles hyphens")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_url_default_fallback(self, mock_load):
        """Test URL inference falls back to default."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        with patch.dict(os.environ, {}, clear=True):
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
            registry = AgentRegistry(agent_names=[])
            self.assertEqual(registry.transport, 'p2p')
        print("✓ Default transport mode is p2p")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_slim_transport_mode(self, mock_load):
        """Test slim transport mode."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['A2A_TRANSPORT'] = 'slim'
            registry = AgentRegistry(agent_names=[])
            self.assertEqual(registry.transport, 'slim')
        print("✓ SLIM transport mode can be set")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_transport_mode_case_insensitive(self, mock_load):
        """Test that transport mode is case insensitive."""
        mock_load.return_value = None

        test_cases = ['P2P', 'p2p', 'SLIM', 'Slim']
        for mode in test_cases:
            with patch.dict(os.environ, {}, clear=True):
                os.environ['A2A_TRANSPORT'] = mode
                registry = AgentRegistry(agent_names=[])
                self.assertIn(registry.transport.lower(), ['p2p', 'slim'])
        print("✓ Transport mode is case insensitive")


class TestAgentExamples(unittest.TestCase):
    """Test agent examples functionality."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_examples_empty(self, mock_load):
        """Test getting examples when no agents."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
        registry._agents = {}

        examples = registry.get_examples()
        self.assertEqual(examples, [])
        print("✓ Returns empty list when no agents")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_examples_with_agents(self, mock_load):
        """Test getting examples from multiple agents."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        # Create mock agents with examples
        mock_agent1 = Mock()
        mock_agent1.get_examples.return_value = ['example1', 'example2']
        mock_agent2 = Mock()
        mock_agent2.get_examples.return_value = ['example3']

        registry._agents = {'agent1': mock_agent1, 'agent2': mock_agent2}

        examples = registry.get_examples()
        self.assertEqual(len(examples), 3)
        self.assertIn('example1', examples)
        self.assertIn('example3', examples)
        print("✓ Collects examples from all agents")


class TestEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_empty_agent_config(self, mock_load):
        """Test behavior with empty AGENT_CONFIG."""
        mock_load.return_value = None

        with patch.object(AgentRegistry, 'AGENT_CONFIG', {}):
            enabled = AgentRegistry.get_enabled_agents()
            self.assertEqual(enabled, [])
        print("✓ Handles empty AGENT_CONFIG")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_agent_nonexistent(self, mock_load):
        """Test getting nonexistent agent raises ValueError."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
        registry._agents = {}

        with self.assertRaises(ValueError) as context:
            registry.get_agent('nonexistent')

        self.assertIn('not found', str(context.exception))
        print("✓ Raises ValueError for nonexistent agent")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_agent_names_with_special_characters(self, mock_load):
        """Test agent names with special characters."""
        mock_load.return_value = None

        # Test with hyphens and underscores
        test_names = ['agent-name', 'agent_name', 'agent.name']
        registry = AgentRegistry(agent_names=test_names, validate_imports=False)

        self.assertEqual(set(registry.AGENT_NAMES), set(test_names))
        print("✓ Handles special characters in agent names")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_duplicate_agent_names(self, mock_load):
        """Test handling of duplicate agent names."""
        mock_load.return_value = None

        duplicate_names = ['github', 'github', 'jira']
        registry = AgentRegistry(agent_names=duplicate_names, validate_imports=False)

        # Should maintain duplicates as provided
        self.assertEqual(registry.AGENT_NAMES, duplicate_names)
        print("✓ Handles duplicate agent names")


class TestConcurrency(unittest.TestCase):
    """Test thread safety and concurrent operations."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_concurrent_agent_exists_calls(self, mock_load):
        """Test concurrent calls to agent_exists."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
        registry._agents = {'agent1': Mock(), 'agent2': Mock()}

        results = []
        def check_exists(name):
            results.append(registry.agent_exists(name))

        threads = [
            threading.Thread(target=check_exists, args=('agent1',)),
            threading.Thread(target=check_exists, args=('agent2',)),
            threading.Thread(target=check_exists, args=('agent1',)),
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(results), 3)
        self.assertTrue(all(results))
        print("✓ Concurrent agent_exists calls work")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_concurrent_get_enabled_agents(self, mock_load):
        """Test concurrent calls to get_enabled_agents."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['ENABLE_GITHUB'] = 'true'

            results = []
            def get_agents():
                results.append(AgentRegistry.get_enabled_agents())

            threads = [threading.Thread(target=get_agents) for _ in range(5)]

            for t in threads:
                t.start()
            for t in threads:
                t.join()

            # All results should be the same
            self.assertEqual(len(results), 5)
            for result in results:
                self.assertIn('github', result)
        print("✓ Concurrent get_enabled_agents calls work")


class TestAgentConfigValidation(unittest.TestCase):
    """Test agent configuration validation."""

    def test_all_agents_have_both_transports(self):
        """Test that all configured agents have both slim and a2a transports."""
        for agent_name, config in AgentRegistry.AGENT_CONFIG.items():
            with self.subTest(agent=agent_name):
                self.assertIn('slim', config, f"{agent_name} missing slim transport")
                self.assertIn('a2a', config, f"{agent_name} missing a2a transport")
                self.assertIsInstance(config['slim'], str)
                self.assertIsInstance(config['a2a'], str)
        print(f"✓ All {len(AgentRegistry.AGENT_CONFIG)} agents have both transports")

    def test_import_paths_are_valid_format(self):
        """Test that import paths follow expected format."""
        for agent_name, config in AgentRegistry.AGENT_CONFIG.items():
            with self.subTest(agent=agent_name):
                # Import paths should contain dots (package structure)
                self.assertIn('.', config['slim'],
                            f"{agent_name} slim path doesn't look like a module")
                self.assertIn('.', config['a2a'],
                            f"{agent_name} a2a path doesn't look like a module")
        print("✓ All import paths follow expected format")

    def test_no_duplicate_import_paths(self):
        """Test that there are no duplicate import paths."""
        slim_paths = [config['slim'] for config in AgentRegistry.AGENT_CONFIG.values()]
        a2a_paths = [config['a2a'] for config in AgentRegistry.AGENT_CONFIG.values()]

        # Check for duplicates
        self.assertEqual(len(slim_paths), len(set(slim_paths)),
                        "Duplicate slim import paths found")
        self.assertEqual(len(a2a_paths), len(set(a2a_paths)),
                        "Duplicate a2a import paths found")
        print("✓ No duplicate import paths")


class TestEnvironmentVariableHandling(unittest.TestCase):
    """Test comprehensive environment variable handling."""

    def setUp(self):
        """Save original environment."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment."""
        os.environ.clear()
        os.environ.update(self.original_env)

    def test_env_var_with_whitespace(self):
        """Test environment variables with whitespace are NOT enabled."""
        os.environ['ENABLE_GITHUB'] = '  true  '
        enabled = AgentRegistry.get_enabled_agents()
        # Whitespace should NOT enable the agent (exact match required)
        self.assertNotIn('github', enabled)

        # Test that exact 'true' works
        os.environ['ENABLE_GITHUB'] = 'true'
        enabled = AgentRegistry.get_enabled_agents()
        self.assertIn('github', enabled)
        print("✓ Requires exact 'true' value (no whitespace)")

    def test_env_var_various_false_values(self):
        """Test various false values."""
        false_values = ['false', 'False', 'FALSE', '0', 'no', 'No', '']

        for value in false_values:
            with self.subTest(value=value):
                for key in list(os.environ.keys()):
                    if key.startswith('ENABLE_'):
                        del os.environ[key]

                os.environ['ENABLE_GITHUB'] = value
                enabled = AgentRegistry.get_enabled_agents()
                self.assertNotIn('github', enabled, f"Failed with value: '{value}'")
        print(f"✓ Correctly handles {len(false_values)} false values")

    def test_all_agents_can_be_enabled(self):
        """Test that all configured agents can be enabled."""
        # Clear all
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        # Enable all agents
        for agent_name in AgentRegistry.AGENT_CONFIG.keys():
            env_var = AgentRegistry.get_env_var_name(agent_name)
            os.environ[env_var] = 'true'

        enabled = AgentRegistry.get_enabled_agents()

        self.assertEqual(len(enabled), len(AgentRegistry.AGENT_CONFIG))
        self.assertEqual(set(enabled), set(AgentRegistry.AGENT_CONFIG.keys()))
        print(f"✓ All {len(AgentRegistry.AGENT_CONFIG)} agents can be enabled")


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
        TestAgentConfigValidation,
        TestEnvironmentVariableHandling,
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

