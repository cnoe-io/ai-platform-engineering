#!/usr/bin/env python3
"""
Unit tests for generate-docker-compose.py

Tests all major functions for generating Docker Compose configurations
from persona definitions.

Run tests:
    python -m pytest scripts/test_generate_docker_compose.py -v
    python -m unittest scripts/test_generate_docker_compose.py
"""

import unittest
import tempfile
import os
import sys
import yaml
import importlib.util
from pathlib import Path

# Import the generate_docker_compose module using importlib
_script_dir = os.path.dirname(os.path.abspath(__file__))
_module_path = os.path.join(_script_dir, 'generate-docker-compose.py')
_spec = importlib.util.spec_from_file_location("generate_docker_compose", _module_path)
_module = importlib.util.module_from_spec(_spec)
sys.modules['generate_docker_compose'] = _module
_spec.loader.exec_module(_module)

# Import functions and constants from the loaded module
load_profiles = _module.load_profiles
get_agent_defaults = _module.get_agent_defaults
get_transport_from_env = _module.get_transport_from_env
generate_platform_engineer_service = _module.generate_platform_engineer_service
generate_agent_service = _module.generate_agent_service
generate_mcp_service = _module.generate_mcp_service
generate_rag_services = _module.generate_rag_services
generate_tracing_services = _module.generate_tracing_services
generate_infrastructure_services = _module.generate_infrastructure_services
generate_docker_compose = _module.generate_docker_compose
generate_banner = _module.generate_banner
ALL_AGENTS = _module.ALL_AGENTS
TRANSPORT_PROFILES = _module.TRANSPORT_PROFILES


class TestConfigurationLoading(unittest.TestCase):
    """Test configuration file loading and parsing."""

    def setUp(self):
        """Create temporary test configuration files."""
        self.test_dir = tempfile.mkdtemp()
        self.config_file = os.path.join(self.test_dir, 'test-persona.yaml')
        
        # Create test persona configuration
        test_config = {
            'persona': {
                'test-basic': {
                    'agents': ['argocd', 'github']
                },
                'test-rag': {
                    'agents': ['rag', 'github']
                }
            }
        }
        
        with open(self.config_file, 'w') as f:
            yaml.dump(test_config, f)

    def tearDown(self):
        """Clean up temporary files."""
        if os.path.exists(self.config_file):
            os.remove(self.config_file)
        os.rmdir(self.test_dir)

    def test_load_profiles_valid_file(self):
        """Test loading a valid persona configuration file."""
        config = load_profiles(self.config_file)
        self.assertIn('persona', config)
        self.assertIn('test-basic', config['persona'])
        self.assertEqual(config['persona']['test-basic']['agents'], ['argocd', 'github'])

    def test_load_profiles_invalid_file(self):
        """Test loading a non-existent file raises error."""
        with self.assertRaises(FileNotFoundError):
            load_profiles('nonexistent.yaml')

    def test_get_transport_from_env(self):
        """Test transport mode detection from environment."""
        # Test default
        if 'A2A_TRANSPORT' in os.environ:
            del os.environ['A2A_TRANSPORT']
        self.assertEqual(get_transport_from_env(), 'p2p')
        
        # Test override
        os.environ['A2A_TRANSPORT'] = 'slim'
        self.assertEqual(get_transport_from_env(), 'slim')
        del os.environ['A2A_TRANSPORT']


class TestAgentConfiguration(unittest.TestCase):
    """Test agent default configuration generation."""

    def test_get_agent_defaults_standard(self):
        """Test default configuration for standard agent."""
        defaults = get_agent_defaults('argocd')
        self.assertEqual(defaults['image'], 'ghcr.io/cnoe-io/agent-argocd:${IMAGE_TAG:-stable}')
        self.assertEqual(defaults['mcp_mode'], 'http')
        self.assertEqual(defaults['mcp_host'], 'mcp-argocd')
        self.assertEqual(defaults['mcp_port'], 8000)
        self.assertTrue(defaults['has_mcp_service'])
        self.assertEqual(defaults['volumes'], [])

    def test_get_agent_defaults_github(self):
        """Test GitHub agent with Docker socket mount."""
        defaults = get_agent_defaults('github')
        self.assertIn('/var/run/docker.sock:/var/run/docker.sock', defaults['volumes'])
        self.assertFalse(defaults['has_mcp_service'])

    def test_get_agent_defaults_weather(self):
        """Test Weather agent with external MCP."""
        defaults = get_agent_defaults('weather')
        self.assertEqual(defaults['mcp_host'], 'weather.outshift.io')
        self.assertEqual(defaults['mcp_port'], 443)
        self.assertFalse(defaults['has_mcp_service'])

    def test_get_agent_defaults_petstore(self):
        """Test Petstore agent with template image."""
        defaults = get_agent_defaults('petstore')
        self.assertEqual(defaults['image'], 'ghcr.io/cnoe-io/agent-template:${IMAGE_TAG:-stable}')
        self.assertEqual(defaults['mcp_host'], 'petstore.outshift.io')
        self.assertFalse(defaults['has_mcp_service'])

    def test_get_agent_defaults_rag(self):
        """Test RAG agent configuration."""
        defaults = get_agent_defaults('rag')
        self.assertEqual(defaults['image'], 'ghcr.io/cnoe-io/caipe-rag-agent-rag:${IMAGE_TAG:-stable}')
        self.assertFalse(defaults['has_mcp_service'])

    def test_all_agents_have_defaults(self):
        """Test that all defined agents have valid configurations."""
        for agent in ALL_AGENTS:
            defaults = get_agent_defaults(agent)
            self.assertIsNotNone(defaults)
            self.assertIn('image', defaults)
            self.assertIn('has_mcp_service', defaults)


class TestPlatformEngineerService(unittest.TestCase):
    """Test CAIPE platform engineer service generation."""

    def test_generate_platform_engineer_basic(self):
        """Test basic platform engineer service generation."""
        service = generate_platform_engineer_service(
            'argocd-p2p',
            ['argocd'],
            'p2p',
            use_profiles=True
        )
        
        self.assertEqual(service['container_name'], 'caipe-argocd-p2p')
        self.assertEqual(service['ports'], ['8000:8000'])
        self.assertIn('A2A_TRANSPORT=p2p', service['environment'])
        self.assertIn('agent-argocd-argocd-p2p', service['depends_on'])
        self.assertIn('../prompt_config.yaml:/app/prompt_config.yaml', service['volumes'])

    def test_generate_platform_engineer_dev_mode(self):
        """Test platform engineer service with dev mode."""
        service = generate_platform_engineer_service(
            'argocd-p2p',
            ['argocd'],
            'p2p',
            dev_mode=True
        )
        
        self.assertIn('build', service)
        self.assertNotIn('image', service)
        self.assertEqual(service['build']['context'], '..')
        self.assertIn('../ai_platform_engineering:/app/ai_platform_engineering', service['volumes'])

    def test_generate_platform_engineer_slim_transport(self):
        """Test platform engineer with SLIM transport."""
        service = generate_platform_engineer_service(
            'argocd-slim',
            ['argocd'],
            'slim'
        )
        
        self.assertIn('A2A_TRANSPORT=slim', service['environment'])
        self.assertIn('slim-dataplane', service['depends_on'])
        self.assertIn('slim-control-plane', service['depends_on'])

    def test_generate_platform_engineer_enable_flags(self):
        """Test that ENABLE flags are set correctly."""
        service = generate_platform_engineer_service(
            'github-p2p',
            ['github', 'argocd'],
            'p2p'
        )
        
        # Check that selected agents are enabled
        self.assertIn('ENABLE_GITHUB=true', service['environment'])
        self.assertIn('ENABLE_ARGOCD=true', service['environment'])
        
        # Check that non-selected agents are disabled
        self.assertIn('ENABLE_AWS=false', service['environment'])
        self.assertIn('ENABLE_JIRA=false', service['environment'])


class TestAgentService(unittest.TestCase):
    """Test individual agent service generation."""

    def test_generate_agent_service_basic(self):
        """Test basic agent service generation."""
        service = generate_agent_service(
            'argocd',
            'argocd-p2p',
            'p2p',
            port_offset=0
        )
        
        self.assertEqual(service['container_name'], 'agent-argocd-argocd-p2p')
        self.assertEqual(service['ports'], ['8001:8000'])
        self.assertIn('A2A_TRANSPORT=p2p', service['environment'])
        self.assertIn('MCP_HOST=mcp-argocd', service['environment'])

    def test_generate_agent_service_dev_mode(self):
        """Test agent service with dev mode."""
        service = generate_agent_service(
            'argocd',
            'argocd-p2p',
            'p2p',
            port_offset=0,
            dev_mode=True
        )
        
        self.assertIn('build', service)
        self.assertNotIn('image', service)
        self.assertIn('volumes', service)

    def test_generate_agent_service_rag(self):
        """Test RAG agent service generation."""
        service = generate_agent_service(
            'rag',
            'rag-p2p',
            'p2p',
            port_offset=0
        )
        
        self.assertEqual(service['container_name'], 'agent_rag')
        self.assertEqual(service['ports'], ['8099:8099'])
        self.assertIn('REDIS_URL=redis://rag-redis:6379/0', service['environment'])
        self.assertIn('rag_server', service['depends_on'])

    def test_generate_agent_service_port_offset(self):
        """Test that port offset works correctly."""
        service1 = generate_agent_service('argocd', 'test-p2p', 'p2p', 0)
        service2 = generate_agent_service('github', 'test-p2p', 'p2p', 5)
        
        self.assertEqual(service1['ports'], ['8001:8000'])
        self.assertEqual(service2['ports'], ['8006:8000'])


class TestMCPService(unittest.TestCase):
    """Test MCP service generation."""

    def test_generate_mcp_service_standard(self):
        """Test standard MCP service generation."""
        service = generate_mcp_service('argocd', ['a2a-p2p'])
        
        self.assertIsNotNone(service)
        self.assertEqual(service['container_name'], 'mcp-argocd')
        self.assertIn('ghcr.io/cnoe-io/mcp-argocd', service['image'])
        self.assertIn('MCP_MODE=http', service['environment'])

    def test_generate_mcp_service_no_mcp_agent(self):
        """Test that agents without MCP return None."""
        service = generate_mcp_service('github', ['a2a-p2p'])
        self.assertIsNone(service)
        
        service = generate_mcp_service('weather', ['a2a-p2p'])
        self.assertIsNone(service)

    def test_generate_mcp_service_dev_mode(self):
        """Test MCP service with dev mode."""
        service = generate_mcp_service('argocd', ['a2a-p2p'], dev_mode=True)
        
        self.assertIn('build', service)
        self.assertNotIn('image', service)
        self.assertIn('volumes', service)


class TestInfrastructureServices(unittest.TestCase):
    """Test infrastructure service generation."""

    def test_generate_infrastructure_services(self):
        """Test SLIM infrastructure generation."""
        services = generate_infrastructure_services()
        
        self.assertIn('slim-dataplane', services)
        self.assertIn('slim-control-plane', services)
        
        # Check dataplane configuration
        self.assertEqual(services['slim-dataplane']['container_name'], 'slim-dataplane')
        self.assertIn('a2a-over-slim', services['slim-dataplane']['profiles'])
        self.assertEqual(services['slim-dataplane']['ports'], ['46357:46357'])

    def test_generate_rag_services(self):
        """Test RAG infrastructure generation."""
        services = generate_rag_services()
        
        required_services = [
            'rag_server', 'agent_ontology', 'neo4j', 'neo4j-ontology',
            'rag-redis', 'milvus-standalone', 'etcd', 'milvus-minio'
        ]
        
        for service_name in required_services:
            self.assertIn(service_name, services)
        
        # Check specific configurations
        self.assertEqual(services['rag_server']['ports'], ['9446:9446'])
        self.assertEqual(services['agent_ontology']['ports'], ['8098:8098'])
        self.assertIn('neo4j', services['agent_ontology']['depends_on'])

    def test_generate_tracing_services(self):
        """Test Langfuse tracing infrastructure generation."""
        services = generate_tracing_services()
        
        required_services = [
            'langfuse-worker', 'langfuse-web', 'langfuse-clickhouse',
            'langfuse-minio', 'langfuse-redis', 'langfuse-postgres'
        ]
        
        for service_name in required_services:
            self.assertIn(service_name, services)
        
        # Check web service configuration
        self.assertEqual(services['langfuse-web']['ports'], ['3000:3000'])
        self.assertIn('langfuse-postgres', services['langfuse-web']['depends_on'])


class TestDockerComposeGeneration(unittest.TestCase):
    """Test complete docker-compose generation."""

    def setUp(self):
        """Create test configuration."""
        self.test_config = {
            'persona': {
                'test-basic': {
                    'agents': ['argocd', 'github']
                },
                'test-rag': {
                    'agents': ['rag']
                },
                'test-tracing': {
                    'agents': ['argocd']
                }
            }
        }

    def test_generate_docker_compose_basic(self):
        """Test basic docker-compose generation."""
        compose = generate_docker_compose(self.test_config, ['test-basic'])
        
        self.assertIn('services', compose)
        
        # Check CAIPE services
        self.assertIn('caipe-test-basic-p2p', compose['services'])
        self.assertIn('caipe-test-basic-slim', compose['services'])
        
        # Check agent services
        self.assertIn('agent-argocd-test-basic-p2p', compose['services'])
        self.assertIn('agent-github-test-basic-p2p', compose['services'])
        
        # Check MCP services
        self.assertIn('mcp-argocd', compose['services'])
        
        # Check infrastructure
        self.assertIn('slim-dataplane', compose['services'])

    def test_generate_docker_compose_rag(self):
        """Test docker-compose generation with RAG services."""
        compose = generate_docker_compose(self.test_config, ['test-rag'])
        
        # Check RAG services are included
        self.assertIn('rag_server', compose['services'])
        self.assertIn('agent_ontology', compose['services'])
        self.assertIn('neo4j', compose['services'])
        self.assertIn('milvus-standalone', compose['services'])
        
        # Check volumes are added
        self.assertIn('volumes', compose)
        self.assertIn('milvus_etcd', compose['volumes'])

    def test_generate_docker_compose_tracing(self):
        """Test docker-compose generation with tracing services."""
        compose = generate_docker_compose(self.test_config, ['test-tracing'])
        
        # Check tracing services are included
        self.assertIn('langfuse-web', compose['services'])
        self.assertIn('langfuse-worker', compose['services'])
        self.assertIn('langfuse-postgres', compose['services'])
        
        # Check volumes are added
        self.assertIn('volumes', compose)
        self.assertIn('langfuse_postgres_data', compose['volumes'])

    def test_generate_docker_compose_dev_mode(self):
        """Test docker-compose generation in dev mode."""
        compose = generate_docker_compose(self.test_config, ['test-basic'], dev_mode=True)
        
        # Check that build contexts are used
        caipe_service = compose['services']['caipe-test-basic-p2p']
        self.assertIn('build', caipe_service)
        self.assertNotIn('image', caipe_service)

    def test_generate_docker_compose_profiles(self):
        """Test that profiles are correctly assigned."""
        compose = generate_docker_compose(self.test_config, ['test-basic'])
        
        # Check P2P profile
        p2p_service = compose['services']['caipe-test-basic-p2p']
        self.assertIn('a2a-p2p', p2p_service['profiles'])
        
        # Check SLIM profile
        slim_service = compose['services']['caipe-test-basic-slim']
        self.assertIn('a2a-over-slim', slim_service['profiles'])


class TestBannerGeneration(unittest.TestCase):
    """Test banner comment generation."""

    def test_generate_banner_single_persona(self):
        """Test banner for single persona."""
        banner = generate_banner(['argocd'], False)
        
        self.assertIn('AUTO-GENERATED FILE', banner)
        self.assertIn('PROD (with container images)', banner)
        self.assertIn('Personas: argocd', banner)
        self.assertIn('a2a-p2p', banner)

    def test_generate_banner_multiple_personas(self):
        """Test banner for multiple personas."""
        banner = generate_banner(['argocd', 'github'], False)
        
        self.assertIn('Personas: argocd, github', banner)

    def test_generate_banner_dev_mode(self):
        """Test banner with dev mode."""
        banner = generate_banner(['argocd'], True)
        
        self.assertIn('DEV (with local code mounts)', banner)
        self.assertIn('--dev', banner)
        self.assertIn('DEV=true', banner)


class TestConstants(unittest.TestCase):
    """Test module constants."""

    def test_all_agents_constant(self):
        """Test ALL_AGENTS contains expected agents."""
        expected_agents = [
            'argocd', 'aws', 'backstage', 'confluence', 'github', 'jira',
            'komodor', 'pagerduty', 'slack', 'splunk', 'weather', 'webex',
            'petstore', 'rag'
        ]
        
        for agent in expected_agents:
            self.assertIn(agent, ALL_AGENTS)

    def test_transport_profiles_constant(self):
        """Test TRANSPORT_PROFILES mapping."""
        self.assertEqual(TRANSPORT_PROFILES['p2p'], 'a2a-p2p')
        self.assertEqual(TRANSPORT_PROFILES['slim'], 'a2a-over-slim')


class TestEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""

    def test_empty_agent_list(self):
        """Test generation with empty agent list."""
        service = generate_platform_engineer_service(
            'empty-p2p',
            [],
            'p2p'
        )
        
        # Should still generate valid service
        self.assertEqual(service['container_name'], 'caipe-empty-p2p')
        self.assertEqual(len(service['depends_on']), 0)

    def test_unknown_agent(self):
        """Test handling of unknown agent name."""
        # Should return defaults without crashing
        defaults = get_agent_defaults('unknown-agent')
        self.assertIsNotNone(defaults)
        self.assertIn('image', defaults)

    def test_custom_env_file_path(self):
        """Test custom environment file path."""
        service = generate_platform_engineer_service(
            'test-p2p',
            ['argocd'],
            'p2p',
            env_file_path='/custom/.env'
        )
        
        self.assertEqual(service['env_file'], ['/custom/.env'])


if __name__ == '__main__':
    unittest.main()

