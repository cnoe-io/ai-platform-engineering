# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Tests for agent generator
"""

import pytest
import tempfile
import shutil
from pathlib import Path
from ai_platform_engineering.utils.agent_generator.agent_generator import AgentGenerator
from ai_platform_engineering.utils.agent_generator.models import (
    AgentManifest,
    AgentMetadata,
    AgentSkillSpec,
    AgentProtocol
)


class TestAgentGenerator:
    """Tests for AgentGenerator"""
    
    @pytest.fixture
    def simple_manifest(self):
        """Fixture providing a simple manifest"""
        return AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test_agent",
                display_name="Test Agent",
                version="1.0.0",
                description="A test agent for unit testing"
            ),
            protocols=[AgentProtocol.A2A],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test Skill",
                    description="A test skill",
                    examples=["Example 1", "Example 2", "Example 3"]
                )
            ]
        )
    
    @pytest.fixture
    def temp_output_dir(self):
        """Fixture providing a temporary output directory"""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        # Cleanup
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    def test_generator_initialization(self):
        """Test generator initialization"""
        generator = AgentGenerator()
        assert generator is not None
    
    def test_generate_dry_run(self, simple_manifest, temp_output_dir):
        """Test dry-run generation"""
        generator = AgentGenerator()
        results = generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=True
        )
        
        assert results['dry_run'] is True
        assert results['agent_name'] == 'test_agent'
        assert len(results['files_created']) > 0
        
        # Verify no files were actually created
        agent_dir = temp_output_dir / 'test_agent'
        assert not agent_dir.exists()
    
    def test_generate_agent(self, simple_manifest, temp_output_dir):
        """Test actual agent generation"""
        generator = AgentGenerator()
        results = generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        assert results['dry_run'] is False
        assert results['agent_name'] == 'test_agent'
        assert len(results['files_created']) > 0
        
        # Verify agent directory was created
        agent_dir = temp_output_dir / 'test_agent'
        assert agent_dir.exists()
        assert agent_dir.is_dir()
    
    def test_generate_creates_package_structure(self, simple_manifest, temp_output_dir):
        """Test that generation creates correct package structure"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        pkg_dir = agent_dir / 'agent_test_agent'
        
        # Check main package files
        assert (pkg_dir / '__init__.py').exists()
        assert (pkg_dir / '__main__.py').exists()
        assert (pkg_dir / 'agentcard.py').exists()
        assert (pkg_dir / 'state.py').exists()
    
    def test_generate_creates_protocol_bindings(self, simple_manifest, temp_output_dir):
        """Test that generation creates protocol binding files"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        a2a_dir = agent_dir / 'agent_test_agent' / 'protocol_bindings' / 'a2a_server'
        
        # Check A2A files
        assert a2a_dir.exists()
        assert (a2a_dir / '__init__.py').exists()
        assert (a2a_dir / 'agent.py').exists()
        assert (a2a_dir / 'agent_executor.py').exists()
    
    def test_generate_creates_build_files(self, simple_manifest, temp_output_dir):
        """Test that generation creates build configuration files"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        
        # Check build files
        assert (agent_dir / 'pyproject.toml').exists()
        assert (agent_dir / 'Makefile').exists()
        assert (agent_dir / 'build' / 'Dockerfile.a2a').exists()
    
    def test_generate_creates_config_files(self, simple_manifest, temp_output_dir):
        """Test that generation creates configuration files"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        
        # Check config files
        assert (agent_dir / '.env.example').exists()
        assert (agent_dir / 'langgraph.json').exists()
    
    def test_generate_creates_documentation(self, simple_manifest, temp_output_dir):
        """Test that generation creates documentation files"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        
        # Check documentation files
        assert (agent_dir / 'README.md').exists()
        assert (agent_dir / 'CHANGELOG.md').exists()
    
    def test_generate_creates_tests(self, simple_manifest, temp_output_dir):
        """Test that generation creates test scaffolding"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        tests_dir = agent_dir / 'tests'
        
        # Check test files
        assert tests_dir.exists()
        assert (tests_dir / '__init__.py').exists()
        assert (tests_dir / 'test_agent.py').exists()
    
    def test_generate_creates_clients(self, simple_manifest, temp_output_dir):
        """Test that generation creates client code"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        
        # Check client files
        assert (agent_dir / 'clients' / 'a2a' / 'agent.py').exists()
        assert (agent_dir / 'clients' / 'slim' / 'agent.py').exists()
    
    def test_generate_existing_directory_error(self, simple_manifest, temp_output_dir):
        """Test that generation fails if directory exists without overwrite"""
        generator = AgentGenerator()
        
        # First generation
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        # Second generation without overwrite should fail
        with pytest.raises(FileExistsError):
            generator.generate(
                manifest=simple_manifest,
                output_dir=temp_output_dir,
                overwrite=False,
                dry_run=False
            )
    
    def test_generate_with_overwrite(self, simple_manifest, temp_output_dir):
        """Test that generation succeeds with overwrite flag"""
        generator = AgentGenerator()
        
        # First generation
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        # Second generation with overwrite should succeed
        results = generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            overwrite=True,
            dry_run=False
        )
        
        assert results['agent_name'] == 'test_agent'
    
    def test_generated_agentcard_content(self, simple_manifest, temp_output_dir):
        """Test that generated agentcard contains correct content"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        agentcard_file = agent_dir / 'agent_test_agent' / 'agentcard.py'
        
        content = agentcard_file.read_text()
        
        # Check that agent name and skill are in the content
        assert 'test_agent' in content
        assert 'Test Skill' in content
        assert 'A test agent for unit testing' in content
    
    def test_generated_readme_content(self, simple_manifest, temp_output_dir):
        """Test that generated README contains correct content"""
        generator = AgentGenerator()
        generator.generate(
            manifest=simple_manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'test_agent'
        readme_file = agent_dir / 'README.md'
        
        content = readme_file.read_text()
        
        # Check that key information is in README
        assert 'Test Agent' in content
        assert '1.0.0' in content
        assert 'A test agent for unit testing' in content
    
    def test_generate_with_mcp_protocol(self, temp_output_dir):
        """Test generation with MCP protocol"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="mcp_test",
                display_name="MCP Test",
                version="1.0.0",
                description="Test MCP generation"
            ),
            protocols=[AgentProtocol.MCP],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test",
                    description="Test"
                )
            ]
        )
        
        generator = AgentGenerator()
        generator.generate(
            manifest=manifest,
            output_dir=temp_output_dir,
            dry_run=False
        )
        
        agent_dir = temp_output_dir / 'mcp_test'
        mcp_dir = agent_dir / 'mcp'
        
        # Check MCP files exist
        assert mcp_dir.exists()
        assert (mcp_dir / 'pyproject.toml').exists()
        assert (mcp_dir / 'Makefile').exists()

