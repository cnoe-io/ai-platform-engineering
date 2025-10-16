# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for the AgentRegistry class.

This test suite covers:
1. Agent configuration and import mapping
2. Environment variable convention (ENABLE_{AGENT_NAME})
3. Agent enablement via environment variables
4. Validation of agent names against configuration
5. Backward compatibility with AGENT_IMPORT_MAP
6. Agent loading and registry initialization
"""

import os
import unittest
from unittest.mock import Mock, patch

# Import the module to test
from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry


class TestAgentConfigStructure(unittest.TestCase):
    """Test the structure and integrity of AGENT_CONFIG."""

    def test_agent_config_exists(self):
        """Test that AGENT_CONFIG is defined and not empty."""
        self.assertIsNotNone(AgentRegistry.AGENT_CONFIG)
        self.assertGreater(len(AgentRegistry.AGENT_CONFIG), 0)
        print(f"✓ AGENT_CONFIG contains {len(AgentRegistry.AGENT_CONFIG)} agents")

    def test_agent_config_structure(self):
        """Test that each agent has required import paths."""
        for agent_name, config in AgentRegistry.AGENT_CONFIG.items():
            with self.subTest(agent=agent_name):
                # Each agent should have 'slim' and 'a2a' import paths
                self.assertIn('slim', config, f"Agent {agent_name} missing 'slim' import path")
                self.assertIn('a2a', config, f"Agent {agent_name} missing 'a2a' import path")

                # Import paths should be non-empty strings
                self.assertIsInstance(config['slim'], str)
                self.assertIsInstance(config['a2a'], str)
                self.assertGreater(len(config['slim']), 0)
                self.assertGreater(len(config['a2a']), 0)
        print(f"✓ All {len(AgentRegistry.AGENT_CONFIG)} agents have valid structure")

    def test_known_agents_present(self):
        """Test that known core agents are present in config."""
        core_agents = ['github', 'jira', 'pagerduty', 'slack', 'argocd', 'backstage']
        for agent in core_agents:
            with self.subTest(agent=agent):
                self.assertIn(agent, AgentRegistry.AGENT_CONFIG,
                            f"Core agent {agent} not found in AGENT_CONFIG")
        print(f"✓ All {len(core_agents)} core agents are present")


class TestEnvVarConvention(unittest.TestCase):
    """Test the environment variable naming convention."""

    def test_get_env_var_name_basic(self):
        """Test basic environment variable name generation."""
        test_cases = [
            ('github', 'ENABLE_GITHUB'),
            ('pagerduty', 'ENABLE_PAGERDUTY'),
            ('argocd', 'ENABLE_ARGOCD'),
            ('slack', 'ENABLE_SLACK'),
        ]

        for agent_name, expected_env_var in test_cases:
            with self.subTest(agent=agent_name):
                result = AgentRegistry.get_env_var_name(agent_name)
                self.assertEqual(result, expected_env_var,
                               f"Expected {expected_env_var}, got {result}")
        print(f"✓ All {len(test_cases)} environment variable names generated correctly")

    def test_get_env_var_name_with_special_chars(self):
        """Test environment variable name generation with special characters."""
        test_cases = [
            ('test-agent', 'ENABLE_TEST-AGENT'),  # Hyphens preserved
            ('test_agent', 'ENABLE_TEST_AGENT'),  # Underscores preserved
        ]

        for agent_name, expected_env_var in test_cases:
            with self.subTest(agent=agent_name):
                result = AgentRegistry.get_env_var_name(agent_name)
                self.assertEqual(result, expected_env_var)
        print("✓ Special character handling works correctly")

    def test_all_agents_have_convention_based_env_vars(self):
        """Test that all configured agents follow the convention."""
        for agent_name in AgentRegistry.AGENT_CONFIG.keys():
            with self.subTest(agent=agent_name):
                env_var = AgentRegistry.get_env_var_name(agent_name)
                self.assertTrue(env_var.startswith('ENABLE_'),
                              f"Env var {env_var} doesn't start with ENABLE_")
                self.assertEqual(env_var, f"ENABLE_{agent_name.upper()}")
        print(f"✓ All {len(AgentRegistry.AGENT_CONFIG)} agents follow naming convention")


class TestGetEnabledAgents(unittest.TestCase):
    """Test the get_enabled_agents class method."""

    def setUp(self):
        """Save original environment variables."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment variables."""
        os.environ.clear()
        os.environ.update(self.original_env)

    def test_no_agents_enabled(self):
        """Test when no agents are enabled via environment variables."""
        # Clear all ENABLE_* variables
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        enabled = AgentRegistry.get_enabled_agents()
        self.assertEqual(len(enabled), 0, "No agents should be enabled")
        print("✓ Returns empty list when no agents enabled")

    def test_single_agent_enabled(self):
        """Test enabling a single agent."""
        # Clear all and enable only github
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'true'
        enabled = AgentRegistry.get_enabled_agents()

        self.assertEqual(len(enabled), 1)
        self.assertIn('github', enabled)
        print("✓ Single agent enablement works")

    def test_multiple_agents_enabled(self):
        """Test enabling multiple agents."""
        # Clear all
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        test_agents = ['github', 'jira', 'slack']
        for agent in test_agents:
            os.environ[AgentRegistry.get_env_var_name(agent)] = 'true'

        enabled = AgentRegistry.get_enabled_agents()

        self.assertEqual(len(enabled), len(test_agents))
        for agent in test_agents:
            self.assertIn(agent, enabled)
        print(f"✓ Multiple agent enablement works ({len(test_agents)} agents)")

    def test_case_insensitive_env_var_values(self):
        """Test that env var values are case-insensitive."""
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        test_cases = ['true', 'True', 'TRUE', 'tRuE']
        for value in test_cases:
            with self.subTest(value=value):
                os.environ['ENABLE_GITHUB'] = value
                enabled = AgentRegistry.get_enabled_agents()
                self.assertIn('github', enabled, f"Failed with value: {value}")
        print("✓ Environment variable values are case-insensitive")

    def test_false_and_missing_env_vars(self):
        """Test that false and missing env vars don't enable agents."""
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'false'
        os.environ['ENABLE_JIRA'] = 'False'
        os.environ['ENABLE_SLACK'] = 'no'
        # ENABLE_PAGERDUTY is missing

        enabled = AgentRegistry.get_enabled_agents()

        self.assertNotIn('github', enabled)
        self.assertNotIn('jira', enabled)
        self.assertNotIn('slack', enabled)
        self.assertNotIn('pagerduty', enabled)
        print("✓ False and missing values don't enable agents")

    def test_validation_flag(self):
        """Test that validation flag works correctly."""
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'true'

        # With validation (default)
        enabled_with_validation = AgentRegistry.get_enabled_agents(validate_imports=True)
        self.assertIn('github', enabled_with_validation)

        # Without validation
        enabled_without_validation = AgentRegistry.get_enabled_agents(validate_imports=False)
        self.assertIn('github', enabled_without_validation)
        print("✓ Validation flag parameter works correctly")


class TestBackwardCompatibility(unittest.TestCase):
    """Test backward compatibility with AGENT_IMPORT_MAP."""

    def test_agent_import_map_property_exists(self):
        """Test that AGENT_IMPORT_MAP property is accessible."""
        registry = AgentRegistry(agent_names=[])
        import_map = registry.AGENT_IMPORT_MAP
        self.assertIsNotNone(import_map)
        self.assertIsInstance(import_map, dict)
        print("✓ AGENT_IMPORT_MAP property is accessible")

    def test_import_map_structure(self):
        """Test that import map has correct structure."""
        registry = AgentRegistry(agent_names=[])
        import_map = registry.AGENT_IMPORT_MAP

        for agent_name, paths in import_map.items():
            with self.subTest(agent=agent_name):
                self.assertIn('slim', paths)
                self.assertIn('a2a', paths)
                self.assertIsInstance(paths['slim'], str)
                self.assertIsInstance(paths['a2a'], str)
        print(f"✓ Import map structure is correct for {len(import_map)} agents")

    def test_import_map_matches_config(self):
        """Test that import map matches AGENT_CONFIG."""
        registry = AgentRegistry(agent_names=[])
        import_map = registry.AGENT_IMPORT_MAP

        self.assertEqual(set(import_map.keys()), set(AgentRegistry.AGENT_CONFIG.keys()))

        for agent_name in AgentRegistry.AGENT_CONFIG.keys():
            self.assertEqual(import_map[agent_name]['slim'],
                           AgentRegistry.AGENT_CONFIG[agent_name]['slim'])
            self.assertEqual(import_map[agent_name]['a2a'],
                           AgentRegistry.AGENT_CONFIG[agent_name]['a2a'])
        print("✓ Import map matches AGENT_CONFIG perfectly")


class TestRegistryInitialization(unittest.TestCase):
    """Test AgentRegistry initialization."""

    def setUp(self):
        """Save original environment variables."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment variables."""
        os.environ.clear()
        os.environ.update(self.original_env)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_init_with_empty_agent_list(self, mock_load):
        """Test initialization with empty agent list."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        self.assertEqual(registry.AGENT_NAMES, [])
        print("✓ Initialization with empty list works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_init_with_explicit_agent_list(self, mock_load):
        """Test initialization with explicit agent list."""
        mock_load.return_value = None
        test_agents = ['github', 'jira', 'slack']
        registry = AgentRegistry(agent_names=test_agents)

        self.assertEqual(registry.AGENT_NAMES, test_agents)
        print(f"✓ Initialization with explicit list works ({len(test_agents)} agents)")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_init_with_validation(self, mock_load):
        """Test initialization with validation enabled."""
        mock_load.return_value = None
        valid_agents = ['github', 'jira']
        invalid_agents = ['invalid_agent', 'fake_agent']
        mixed_agents = valid_agents + invalid_agents

        registry = AgentRegistry(agent_names=mixed_agents, validate_imports=True)

        # Only valid agents should be included
        for agent in valid_agents:
            self.assertIn(agent, registry.AGENT_NAMES)
        for agent in invalid_agents:
            self.assertNotIn(agent, registry.AGENT_NAMES)
        print("✓ Validation filters out invalid agents")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_init_without_validation(self, mock_load):
        """Test initialization with validation disabled."""
        mock_load.return_value = None
        mixed_agents = ['github', 'invalid_agent']

        registry = AgentRegistry(agent_names=mixed_agents, validate_imports=False)

        # All agents should be included when validation is off
        self.assertEqual(len(registry.AGENT_NAMES), len(mixed_agents))
        print("✓ Without validation, all agents are accepted")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_init_with_env_vars(self, mock_load):
        """Test initialization using environment variables."""
        mock_load.return_value = None

        # Clear all ENABLE_* vars
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        # Enable some agents
        os.environ['ENABLE_GITHUB'] = 'true'
        os.environ['ENABLE_JIRA'] = 'true'

        registry = AgentRegistry()  # No explicit agent_names

        self.assertIn('github', registry.AGENT_NAMES)
        self.assertIn('jira', registry.AGENT_NAMES)
        print("✓ Environment variable-based initialization works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_transport_mode_config(self, mock_load):
        """Test transport mode configuration."""
        mock_load.return_value = None

        # Test default transport
        registry = AgentRegistry(agent_names=[])
        self.assertIn(registry.transport, ['p2p', 'slim'])
        print(f"✓ Transport mode configured: {registry.transport}")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_check_config(self, mock_load):
        """Test connectivity check configuration."""
        mock_load.return_value = None

        registry = AgentRegistry(agent_names=[])
        self.assertIsInstance(registry._check_connectivity, bool)
        self.assertIsInstance(registry._connectivity_timeout, float)
        self.assertIsInstance(registry._max_retries, int)
        print("✓ Connectivity check configuration is valid")


class TestAgentProperties(unittest.TestCase):
    """Test AgentRegistry properties and methods."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_agents_property(self, mock_load):
        """Test the agents property."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        agents = registry.agents
        self.assertIsInstance(agents, dict)
        print("✓ agents property returns dict")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_transport_property(self, mock_load):
        """Test the transport property."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        transport = registry.transport
        self.assertIn(transport, ['p2p', 'slim'])
        print(f"✓ transport property returns valid value: {transport}")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_agent_exists_method(self, mock_load):
        """Test the agent_exists method."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])
        registry._agents = {'github': Mock(), 'jira': Mock()}

        self.assertTrue(registry.agent_exists('github'))
        self.assertTrue(registry.agent_exists('jira'))
        self.assertFalse(registry.agent_exists('nonexistent'))
        print("✓ agent_exists method works correctly")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_agent_method(self, mock_load):
        """Test the get_agent method."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        mock_github = Mock()
        registry._agents = {'github': mock_github}

        # Test successful retrieval
        agent = registry.get_agent('github')
        self.assertEqual(agent, mock_github)

        # Test error on nonexistent agent
        with self.assertRaises(ValueError):
            registry.get_agent('nonexistent')
        print("✓ get_agent method works correctly")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_all_agents_method(self, mock_load):
        """Test the get_all_agents method."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        mock_agents = [Mock(), Mock(), Mock()]
        registry._agents = {f'agent{i}': agent for i, agent in enumerate(mock_agents)}

        all_agents = registry.get_all_agents()
        self.assertEqual(len(all_agents), len(mock_agents))
        print(f"✓ get_all_agents returns {len(all_agents)} agents")


class TestUtilityMethods(unittest.TestCase):
    """Test utility methods."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_agent_url_from_env_var(self, mock_load):
        """Test URL inference from environment variables."""
        mock_load.return_value = None
        registry = AgentRegistry(agent_names=[])

        # Test with custom URL
        os.environ['GITHUB_AGENT_URL'] = 'http://custom-github:9000'
        url = registry._infer_agent_url_from_env_var('github')
        self.assertEqual(url, 'http://custom-github:9000')

        # Test with default
        url_default = registry._infer_agent_url_from_env_var('nonexistent')
        self.assertEqual(url_default, 'http://localhost:8000')
        print("✓ URL inference from env vars works")


class TestConvenienceFunction(unittest.TestCase):
    """Test the convenience function in __init__.py."""

    def setUp(self):
        """Save original environment variables."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment variables."""
        os.environ.clear()
        os.environ.update(self.original_env)

    def test_convenience_function_exists(self):
        """Test that get_enabled_agents convenience function exists."""
        from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry
        self.assertIsNotNone(AgentRegistry.get_enabled_agents)
        print("✓ Convenience function exists")

    def test_convenience_function_works(self):
        """Test that convenience function works correctly."""
        from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry

        # Clear all
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'true'
        enabled = AgentRegistry.get_enabled_agents()

        self.assertIn('github', enabled)
        print("✓ Convenience function works correctly")


def run_tests():
    """Run all tests and provide summary."""
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # Add all test classes
    test_classes = [
        TestAgentConfigStructure,
        TestEnvVarConvention,
        TestGetEnabledAgents,
        TestBackwardCompatibility,
        TestRegistryInitialization,
        TestAgentProperties,
        TestUtilityMethods,
        TestConvenienceFunction,
    ]

    for test_class in test_classes:
        tests = loader.loadTestsFromTestCase(test_class)
        suite.addTests(tests)

    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # Print summary
    print("\n" + "="*70)
    print("TEST SUMMARY")
    print("="*70)
    print(f"Total tests run: {result.testsRun}")
    print(f"Successes: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print("="*70)

    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    exit(run_tests())

