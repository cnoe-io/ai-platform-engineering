# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Tests for agent manifest data models
"""

import pytest
from pydantic import ValidationError
from ai_platform_engineering.utils.agent_generator.models import (
    AgentManifest,
    AgentMetadata,
    AgentSkillSpec,
    AgentProtocol,
    DependencySpec,
    DependencySource,
    EnvironmentVariable
)


class TestAgentMetadata:
    """Tests for AgentMetadata model"""
    
    def test_valid_metadata(self):
        """Test valid metadata creation"""
        metadata = AgentMetadata(
            name="test_agent",
            display_name="Test Agent",
            version="1.0.0",
            description="A test agent for unit testing"
        )
        assert metadata.name == "test_agent"
        assert metadata.display_name == "Test Agent"
    
    def test_name_validation_lowercase(self):
        """Test that agent name must be lowercase"""
        with pytest.raises(ValidationError) as exc_info:
            AgentMetadata(
                name="TestAgent",  # Uppercase not allowed
                display_name="Test Agent",
                version="1.0.0",
                description="Test"
            )
        assert "lowercase" in str(exc_info.value).lower()
    
    def test_name_validation_no_spaces(self):
        """Test that agent name cannot contain spaces"""
        with pytest.raises(ValidationError) as exc_info:
            AgentMetadata(
                name="test agent",  # Spaces not allowed
                display_name="Test Agent",
                version="1.0.0",
                description="Test"
            )
        assert "cannot contain spaces" in str(exc_info.value)
    
    def test_name_validation_special_chars(self):
        """Test that agent name allows hyphens and underscores"""
        metadata = AgentMetadata(
            name="test-agent_123",
            display_name="Test Agent",
            version="1.0.0",
            description="Test"
        )
        assert metadata.name == "test-agent_123"
    
    def test_optional_fields(self):
        """Test optional metadata fields"""
        metadata = AgentMetadata(
            name="test",
            display_name="Test",
            version="1.0.0",
            description="Test",
            author="Test Author",
            author_email="test@example.com",
            tags=["test", "demo"]
        )
        assert metadata.author == "Test Author"
        assert "test" in metadata.tags


class TestAgentSkillSpec:
    """Tests for AgentSkillSpec model"""
    
    def test_valid_skill(self):
        """Test valid skill creation"""
        skill = AgentSkillSpec(
            id="test_skill",
            name="Test Skill",
            description="A test skill"
        )
        assert skill.id == "test_skill"
        assert skill.name == "Test Skill"
    
    def test_skill_with_examples(self):
        """Test skill with examples"""
        skill = AgentSkillSpec(
            id="test_skill",
            name="Test Skill",
            description="A test skill",
            examples=["Example 1", "Example 2"]
        )
        assert len(skill.examples) == 2
    
    def test_skill_with_tags(self):
        """Test skill with tags"""
        skill = AgentSkillSpec(
            id="test_skill",
            name="Test Skill",
            description="A test skill",
            tags=["tag1", "tag2"]
        )
        assert "tag1" in skill.tags


class TestDependencySpec:
    """Tests for DependencySpec model"""
    
    def test_pypi_dependency(self):
        """Test PyPI dependency"""
        dep = DependencySpec(
            source=DependencySource.PYPI,
            name="requests",
            version=">=2.31.0"
        )
        assert dep.source == DependencySource.PYPI
        assert dep.name == "requests"
        assert dep.version == ">=2.31.0"
    
    def test_openapi_dependency(self):
        """Test OpenAPI dependency"""
        dep = DependencySpec(
            source=DependencySource.OPENAPI,
            name="my-api",
            url="https://api.example.com/openapi.json"
        )
        assert dep.source == DependencySource.OPENAPI
        assert dep.url is not None
    
    def test_dependency_with_api_key(self):
        """Test dependency with API key"""
        dep = DependencySpec(
            source=DependencySource.OPENAPI,
            name="my-api",
            url="https://api.example.com/openapi.json",
            api_key_env_var="MY_API_KEY"
        )
        assert dep.api_key_env_var == "MY_API_KEY"


class TestEnvironmentVariable:
    """Tests for EnvironmentVariable model"""
    
    def test_required_variable(self):
        """Test required environment variable"""
        env_var = EnvironmentVariable(
            name="MY_VAR",
            description="My variable",
            required=True
        )
        assert env_var.required is True
        assert env_var.default is None
    
    def test_optional_variable_with_default(self):
        """Test optional variable with default"""
        env_var = EnvironmentVariable(
            name="MY_VAR",
            description="My variable",
            required=False,
            default="default_value"
        )
        assert env_var.required is False
        assert env_var.default == "default_value"


class TestAgentManifest:
    """Tests for AgentManifest model"""
    
    def test_minimal_valid_manifest(self):
        """Test minimal valid manifest"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="Test agent"
            ),
            protocols=[AgentProtocol.A2A],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test Skill",
                    description="A test skill"
                )
            ]
        )
        assert manifest.manifest_version == "1.0"
        assert len(manifest.skills) == 1
    
    def test_manifest_requires_skills(self):
        """Test that manifest requires at least one skill"""
        with pytest.raises(ValidationError) as exc_info:
            AgentManifest(
                manifest_version="1.0",
                metadata=AgentMetadata(
                    name="test",
                    display_name="Test",
                    version="1.0.0",
                    description="Test"
                ),
                protocols=[AgentProtocol.A2A],
                skills=[]  # Empty skills not allowed
            )
        assert "at least one skill" in str(exc_info.value).lower()
    
    def test_manifest_with_dependencies(self):
        """Test manifest with dependencies"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="Test"
            ),
            protocols=[AgentProtocol.A2A],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test",
                    description="Test"
                )
            ],
            dependencies=[
                DependencySpec(
                    source=DependencySource.PYPI,
                    name="requests"
                )
            ]
        )
        assert len(manifest.dependencies) == 1
    
    def test_manifest_with_environment(self):
        """Test manifest with environment variables"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="Test"
            ),
            protocols=[AgentProtocol.A2A],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test",
                    description="Test"
                )
            ],
            environment=[
                EnvironmentVariable(
                    name="TEST_VAR",
                    description="Test variable",
                    required=True
                )
            ]
        )
        assert len(manifest.environment) == 1
    
    def test_manifest_to_dict(self):
        """Test converting manifest to dictionary"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="Test"
            ),
            protocols=[AgentProtocol.A2A],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test",
                    description="Test"
                )
            ]
        )
        manifest_dict = manifest.to_dict()
        assert isinstance(manifest_dict, dict)
        assert manifest_dict['manifest_version'] == "1.0"
        assert 'metadata' in manifest_dict
        assert 'skills' in manifest_dict
    
    def test_manifest_from_dict(self):
        """Test creating manifest from dictionary"""
        manifest_dict = {
            'manifest_version': '1.0',
            'metadata': {
                'name': 'test',
                'display_name': 'Test',
                'version': '1.0.0',
                'description': 'Test agent'
            },
            'protocols': ['a2a'],
            'skills': [
                {
                    'id': 'test_skill',
                    'name': 'Test Skill',
                    'description': 'A test skill'
                }
            ]
        }
        manifest = AgentManifest.from_dict(manifest_dict)
        assert manifest.metadata.name == 'test'
        assert len(manifest.skills) == 1

