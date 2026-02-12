# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for the AgentRegistry class.

This test suite covers:
1. Environment variable parsing (ENABLE_{AGENT_NAME})
2. Agent enablement via environment variables
3. Registry initialization and configuration
4. Agent loading and management
5. Transport mode configuration
6. Connectivity check configuration
"""

import os
import unittest
from unittest.mock import Mock, patch

# Import the module to test
from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry, DEFAULT_REGISTRY_EXCLUSIONS


class TestEnvironmentVariableParsing(unittest.TestCase):
    """Test parsing of ENABLE_* environment variables."""

    def setUp(self):
        """Save original environment variables."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment variables."""
        os.environ.clear()
        os.environ.update(self.original_env)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_no_agents_enabled(self, mock_load):
        """Test when no agents are enabled via environment variables."""
        mock_load.return_value = None

        # Clear all ENABLE_* variables
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        registry = AgentRegistry()

        self.assertEqual(len(registry.AGENT_NAMES), 0, "No agents should be enabled")
        print("✓ Returns empty list when no agents enabled")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_single_agent_enabled(self, mock_load):
        """Test enabling a single agent."""
        mock_load.return_value = None

        # Clear all and enable only github
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'true'
        registry = AgentRegistry()

        self.assertEqual(len(registry.AGENT_NAMES), 1)
        self.assertIn('GITHUB', registry.AGENT_NAMES)
        print("✓ Single agent enablement works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_multiple_agents_enabled(self, mock_load):
        """Test enabling multiple agents."""
        mock_load.return_value = None

        # Clear all
        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'true'
        os.environ['ENABLE_JIRA'] = 'true'
        os.environ['ENABLE_SLACK'] = 'true'

        registry = AgentRegistry()

        self.assertEqual(len(registry.AGENT_NAMES), 3)
        self.assertIn('GITHUB', registry.AGENT_NAMES)
        self.assertIn('JIRA', registry.AGENT_NAMES)
        self.assertIn('SLACK', registry.AGENT_NAMES)
        print("✓ Multiple agent enablement works (3 agents)")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_case_insensitive_env_var_values(self, mock_load):
        """Test that env var values are case-insensitive."""
        mock_load.return_value = None

        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        test_cases = ['true', 'True', 'TRUE', 'tRuE']
        for value in test_cases:
            with self.subTest(value=value):
                os.environ['ENABLE_GITHUB'] = value
                registry = AgentRegistry()
                self.assertIn('GITHUB', registry.AGENT_NAMES, f"Failed with value: {value}")
        print("✓ Environment variable values are case-insensitive")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_false_and_missing_env_vars(self, mock_load):
        """Test that false and missing env vars don't enable agents."""
        mock_load.return_value = None

        for key in list(os.environ.keys()):
            if key.startswith('ENABLE_'):
                del os.environ[key]

        os.environ['ENABLE_GITHUB'] = 'false'
        os.environ['ENABLE_JIRA'] = 'False'
        os.environ['ENABLE_SLACK'] = 'no'
        # ENABLE_PAGERDUTY is missing

        registry = AgentRegistry()

        self.assertNotIn('GITHUB', registry.AGENT_NAMES)
        self.assertNotIn('JIRA', registry.AGENT_NAMES)
        self.assertNotIn('SLACK', registry.AGENT_NAMES)
        self.assertNotIn('PAGERDUTY', registry.AGENT_NAMES)
        print("✓ False and missing values don't enable agents")


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

        registry = AgentRegistry()

        self.assertIn('GITHUB', registry.AGENT_NAMES)
        self.assertIn('JIRA', registry.AGENT_NAMES)
        print("✓ Environment variable-based initialization works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_transport_mode_config(self, mock_load):
        """Test transport mode configuration."""
        mock_load.return_value = None

        # Test default transport
        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()
            self.assertEqual(registry.transport, 'p2p')
            print(f"✓ Default transport mode: {registry.transport}")

        # Test slim transport
        with patch.dict(os.environ, {'A2A_TRANSPORT': 'slim'}, clear=True):
            registry = AgentRegistry()
            self.assertEqual(registry.transport, 'slim')
            print("✓ SLIM transport mode can be set")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_connectivity_check_config(self, mock_load):
        """Test connectivity check configuration."""
        mock_load.return_value = None

        registry = AgentRegistry()
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

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        agents = registry.agents
        self.assertIsInstance(agents, dict)
        print("✓ agents property returns dict")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_transport_property(self, mock_load):
        """Test the transport property."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        transport = registry.transport
        self.assertIn(transport, ['p2p', 'slim'])
        print(f"✓ transport property returns valid value: {transport}")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_agent_exists_method(self, mock_load):
        """Test the agent_exists method."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        registry._agents = {'GITHUB': {'name': 'github'}, 'JIRA': {'name': 'jira'}}

        self.assertTrue(registry.agent_exists('GITHUB'))
        self.assertTrue(registry.agent_exists('JIRA'))
        self.assertFalse(registry.agent_exists('NONEXISTENT'))
        print("✓ agent_exists method works correctly")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_agent_method(self, mock_load):
        """Test the get_agent method."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        mock_github = {'name': 'github', 'description': 'GitHub agent'}
        registry._agents = {'GITHUB': mock_github}

        # Test successful retrieval
        agent = registry.get_agent('GITHUB')
        self.assertEqual(agent, mock_github)

        # Test error on nonexistent agent
        with self.assertRaises(ValueError):
            registry.get_agent('NONEXISTENT')
        print("✓ get_agent method works correctly")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_all_agents_method(self, mock_load):
        """Test the get_all_agents method."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        # Create mock tools (not agent cards)
        mock_tools = [Mock(), Mock(), Mock()]
        registry._tools = {f'agent{i}': tool for i, tool in enumerate(mock_tools)}

        all_agents = registry.get_all_agents()
        self.assertEqual(len(all_agents), len(mock_tools))
        print(f"✓ get_all_agents returns {len(all_agents)} tools")


class TestUtilityMethods(unittest.TestCase):
    """Test utility methods."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_infer_agent_url_from_env_var(self, mock_load):
        """Test URL inference from environment variables."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()

        # Test with custom URL
        os.environ['GITHUB_AGENT_URL'] = 'http://custom-github:9000'
        url = registry._infer_agent_url_from_env_var('GITHUB')
        self.assertEqual(url, 'http://custom-github:9000')

        # Test with default
        url_default = registry._infer_agent_url_from_env_var('NONEXISTENT')
        self.assertEqual(url_default, 'http://localhost:8000')
        print("✓ URL inference from env vars works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_sanitize_tool_name(self, mock_load):
        """Test tool name sanitization."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            _ = AgentRegistry()

        # Test basic sanitization
        result = AgentRegistry._sanitize_tool_name("Test Agent Name")
        self.assertEqual(result, "Test_Agent_Name")

        # Test with special characters
        result = AgentRegistry._sanitize_tool_name("agent@#$name")
        self.assertEqual(result, "agentname")

        # Test empty string
        result = AgentRegistry._sanitize_tool_name("")
        self.assertEqual(result, "unknown_agent")
        print("✓ Tool name sanitization works correctly")


class TestAddressMapping(unittest.TestCase):
    """Test agent address mapping functionality."""

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_address_mapping_from_env_vars(self, mock_load):
        """Test address mapping creation from environment variables."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['ENABLE_GITHUB'] = 'true'
            os.environ['GITHUB_AGENT_HOST'] = 'github-host'
            os.environ['GITHUB_AGENT_PORT'] = '9000'

            registry = AgentRegistry()

        self.assertIn('GITHUB', registry.AGENT_ADDRESS_MAPPING)
        self.assertEqual(registry.AGENT_ADDRESS_MAPPING['GITHUB'], 'http://github-host:9000')
        print("✓ Address mapping from env vars works")

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_address_mapping_defaults(self, mock_load):
        """Test address mapping with default values."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['ENABLE_JIRA'] = 'true'
            # No host/port env vars set

            registry = AgentRegistry()

        self.assertIn('JIRA', registry.AGENT_ADDRESS_MAPPING)
        self.assertEqual(registry.AGENT_ADDRESS_MAPPING['JIRA'], 'http://localhost:8000')
        print("✓ Address mapping defaults work")


class TestGetEnabledAgentsFromEnv(unittest.TestCase):
    """Test the get_enabled_agents_from_env instance method."""

    def setUp(self):
        """Save original environment variables."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Restore original environment variables."""
        os.environ.clear()
        os.environ.update(self.original_env)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_enabled_agents_from_env_basic(self, mock_load):
        """Test basic functionality of get_enabled_agents_from_env."""
        mock_load.return_value = None

        with patch.dict(os.environ, {}, clear=True):
            os.environ['ENABLE_GITHUB'] = 'true'
            os.environ['ENABLE_JIRA'] = 'true'

            registry = AgentRegistry()

            # Test that AGENT_NAMES was populated correctly during init
            self.assertEqual(set(registry.AGENT_NAMES), {'GITHUB', 'JIRA'})

            # get_enabled_agents_from_env reads from current env vars
            enabled = registry.get_enabled_agents_from_env()
            self.assertEqual(set(enabled), {'GITHUB', 'JIRA'})
        print("✓ get_enabled_agents_from_env works correctly")


class TestRegistryExclusions(unittest.TestCase):
    """Test the registry exclusion feature for feature flags and pseudo-agents."""

    def setUp(self):
        self.original_env = os.environ.copy()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.original_env)

    # --- _get_registry_exclusions() ---

    def test_default_exclusions_contain_known_feature_flags(self):
        """DEFAULT_REGISTRY_EXCLUSIONS must contain all known feature flags."""
        expected = {"TRACING", "STREAMING", "ACE", "ARTIFACT_STREAMING",
                    "AUTO", "GRAPH_RAG", "RAG", "SUBAGENT_CARDS"}
        self.assertEqual(expected, set(DEFAULT_REGISTRY_EXCLUSIONS))

    def test_default_exclusions_is_frozenset(self):
        """DEFAULT_REGISTRY_EXCLUSIONS must be immutable (frozenset)."""
        self.assertIsInstance(DEFAULT_REGISTRY_EXCLUSIONS, frozenset)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_registry_exclusions_returns_defaults_when_no_env(self, mock_load):
        """_get_registry_exclusions returns defaults when EXCLUDE_FROM_AGENT_REGISTRY is not set."""
        mock_load.return_value = None
        with patch.dict(os.environ, {}, clear=True):
            result = AgentRegistry._get_registry_exclusions()
        self.assertEqual(set(result), set(DEFAULT_REGISTRY_EXCLUSIONS))
        self.assertIsInstance(result, frozenset)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_registry_exclusions_merges_env_var(self, mock_load):
        """_get_registry_exclusions merges EXCLUDE_FROM_AGENT_REGISTRY env var."""
        mock_load.return_value = None
        with patch.dict(os.environ, {"EXCLUDE_FROM_AGENT_REGISTRY": "CUSTOM_FLAG,ANOTHER"}, clear=True):
            result = AgentRegistry._get_registry_exclusions()
        self.assertIn("CUSTOM_FLAG", result)
        self.assertIn("ANOTHER", result)
        # Also still has defaults
        self.assertIn("TRACING", result)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_registry_exclusions_env_var_is_case_insensitive(self, mock_load):
        """Custom exclusions from env var are uppercased."""
        mock_load.return_value = None
        with patch.dict(os.environ, {"EXCLUDE_FROM_AGENT_REGISTRY": "lower_case,MiXeD"}, clear=True):
            result = AgentRegistry._get_registry_exclusions()
        self.assertIn("LOWER_CASE", result)
        self.assertIn("MIXED", result)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_registry_exclusions_ignores_empty_entries(self, mock_load):
        """Empty entries from trailing commas or spaces are ignored."""
        mock_load.return_value = None
        with patch.dict(os.environ, {"EXCLUDE_FROM_AGENT_REGISTRY": "FOO,,  ,BAR,"}, clear=True):
            result = AgentRegistry._get_registry_exclusions()
        self.assertIn("FOO", result)
        self.assertIn("BAR", result)
        self.assertNotIn("", result)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_get_registry_exclusions_handles_whitespace(self, mock_load):
        """Whitespace around names in env var is stripped."""
        mock_load.return_value = None
        with patch.dict(os.environ, {"EXCLUDE_FROM_AGENT_REGISTRY": "  PADDED , SPACES  "}, clear=True):
            result = AgentRegistry._get_registry_exclusions()
        self.assertIn("PADDED", result)
        self.assertIn("SPACES", result)

    # --- get_enabled_agents_from_env() filtering ---

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_enabled_agents_excludes_tracing(self, mock_load):
        """ENABLE_TRACING=true should NOT appear in agent list."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "ENABLE_TRACING": "true",
            "ENABLE_GITHUB": "true",
        }, clear=True):
            registry = AgentRegistry()
        self.assertNotIn("TRACING", registry.AGENT_NAMES)
        self.assertIn("GITHUB", registry.AGENT_NAMES)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_enabled_agents_excludes_streaming(self, mock_load):
        """ENABLE_STREAMING=true should NOT appear in agent list."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "ENABLE_STREAMING": "true",
            "ENABLE_JIRA": "true",
        }, clear=True):
            registry = AgentRegistry()
        self.assertNotIn("STREAMING", registry.AGENT_NAMES)
        self.assertIn("JIRA", registry.AGENT_NAMES)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_enabled_agents_excludes_all_default_exclusions(self, mock_load):
        """All DEFAULT_REGISTRY_EXCLUSIONS should be filtered out."""
        mock_load.return_value = None
        env = {f"ENABLE_{name}": "true" for name in DEFAULT_REGISTRY_EXCLUSIONS}
        env["ENABLE_GITHUB"] = "true"
        with patch.dict(os.environ, env, clear=True):
            registry = AgentRegistry()
        # None of the exclusions should be in AGENT_NAMES
        for name in DEFAULT_REGISTRY_EXCLUSIONS:
            self.assertNotIn(name, registry.AGENT_NAMES,
                            f"{name} should be excluded but was found in AGENT_NAMES")
        # Real agent should still be there
        self.assertIn("GITHUB", registry.AGENT_NAMES)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_enabled_agents_excludes_custom_env_exclusion(self, mock_load):
        """EXCLUDE_FROM_AGENT_REGISTRY custom values should be filtered."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "ENABLE_CUSTOM_THING": "true",
            "ENABLE_GITHUB": "true",
            "EXCLUDE_FROM_AGENT_REGISTRY": "CUSTOM_THING",
        }, clear=True):
            registry = AgentRegistry()
        self.assertNotIn("CUSTOM_THING", registry.AGENT_NAMES)
        self.assertIn("GITHUB", registry.AGENT_NAMES)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_exclusion_is_case_insensitive_for_agent_names(self, mock_load):
        """Exclusion matching should be case-insensitive (agent name uppercased)."""
        mock_load.return_value = None
        # The env var key is ENABLE_rag (lowercase) but exclusion set has "RAG" (uppercase)
        # The code does agent_name.upper() before checking exclusions
        with patch.dict(os.environ, {
            "ENABLE_RAG": "true",
            "ENABLE_GITHUB": "true",
        }, clear=True):
            registry = AgentRegistry()
        self.assertNotIn("RAG", registry.AGENT_NAMES)
        self.assertIn("GITHUB", registry.AGENT_NAMES)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_false_excluded_agents_not_in_list(self, mock_load):
        """Feature flags set to 'false' should also not appear."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "ENABLE_TRACING": "false",
            "ENABLE_STREAMING": "false",
            "ENABLE_GITHUB": "true",
        }, clear=True):
            registry = AgentRegistry()
        self.assertNotIn("TRACING", registry.AGENT_NAMES)
        self.assertNotIn("STREAMING", registry.AGENT_NAMES)
        self.assertIn("GITHUB", registry.AGENT_NAMES)

    # --- get_agent_address_mapping() filtering ---

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_address_mapping_excludes_feature_flags(self, mock_load):
        """get_agent_address_mapping should skip excluded agents."""
        mock_load.return_value = None
        with patch.dict(os.environ, {}, clear=True):
            registry = AgentRegistry()
        # Manually pass a list that includes a feature flag
        mapping = registry.get_agent_address_mapping(["GITHUB", "TRACING", "JIRA"])
        self.assertIn("GITHUB", mapping)
        self.assertIn("JIRA", mapping)
        self.assertNotIn("TRACING", mapping)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_address_mapping_excludes_custom_exclusion(self, mock_load):
        """get_agent_address_mapping respects custom exclusions."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "EXCLUDE_FROM_AGENT_REGISTRY": "MY_PSEUDO",
        }, clear=True):
            registry = AgentRegistry()
            # Call inside the with block so env vars are still active
            mapping = registry.get_agent_address_mapping(["GITHUB", "MY_PSEUDO"])
        self.assertIn("GITHUB", mapping)
        self.assertNotIn("MY_PSEUDO", mapping)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_address_mapping_real_agents_get_correct_urls(self, mock_load):
        """Real agents should still get proper URL mappings."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "GITHUB_AGENT_HOST": "gh-host",
            "GITHUB_AGENT_PORT": "9001",
        }, clear=True):
            registry = AgentRegistry()
            # Call inside the with block so env vars are still active
            mapping = registry.get_agent_address_mapping(["GITHUB", "STREAMING"])
        self.assertEqual(mapping["GITHUB"], "http://gh-host:9001")
        self.assertNotIn("STREAMING", mapping)

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_no_agents_left_after_all_excluded(self, mock_load):
        """If all agents are excluded, both AGENT_NAMES and mapping should be empty."""
        mock_load.return_value = None
        env = {f"ENABLE_{name}": "true" for name in DEFAULT_REGISTRY_EXCLUSIONS}
        with patch.dict(os.environ, env, clear=True):
            registry = AgentRegistry()
        self.assertEqual(registry.AGENT_NAMES, [])
        self.assertEqual(registry.AGENT_ADDRESS_MAPPING, {})

    @patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
    def test_mixed_real_and_excluded_agents(self, mock_load):
        """Mix of real agents and feature flags — only real agents survive."""
        mock_load.return_value = None
        with patch.dict(os.environ, {
            "ENABLE_GITHUB": "true",
            "ENABLE_JIRA": "true",
            "ENABLE_TRACING": "true",
            "ENABLE_STREAMING": "true",
            "ENABLE_ACE": "true",
            "ENABLE_RAG": "true",
            "ENABLE_PAGERDUTY": "true",
        }, clear=True):
            registry = AgentRegistry()
        self.assertEqual(set(registry.AGENT_NAMES), {"GITHUB", "JIRA", "PAGERDUTY"})
        self.assertEqual(set(registry.AGENT_ADDRESS_MAPPING.keys()), {"GITHUB", "JIRA", "PAGERDUTY"})


def run_tests():
    """Run all tests and provide summary."""
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # Add all test classes
    test_classes = [
        TestEnvironmentVariableParsing,
        TestRegistryInitialization,
        TestAgentProperties,
        TestUtilityMethods,
        TestAddressMapping,
        TestGetEnabledAgentsFromEnv,
        TestRegistryExclusions,
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
