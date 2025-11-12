# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Tests for manifest validator
"""

import pytest
from ai_platform_engineering.utils.agent_generator.manifest_validator import (
    AgentManifestValidator,
    ValidationError as ValidatorError
)
from ai_platform_engineering.utils.agent_generator.models import (
    AgentManifest,
    AgentMetadata,
    AgentSkillSpec,
    AgentProtocol,
    DependencySpec,
    DependencySource,
    EnvironmentVariable
)


class TestAgentManifestValidator:
    """Tests for AgentManifestValidator"""
    
    @pytest.fixture
    def valid_manifest(self):
        """Fixture providing a valid manifest"""
        return AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test_agent",
                display_name="Test Agent",
                version="1.0.0",
                description="A test agent with a good description",
                author="Test Author"
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
    
    def test_validate_valid_manifest(self, valid_manifest):
        """Test validating a valid manifest"""
        is_valid, errors = AgentManifestValidator.validate(valid_manifest)
        assert is_valid is True
        # May have warnings but no errors
        error_count = sum(1 for e in errors if e.severity == "error")
        assert error_count == 0
    
    def test_validate_metadata_name_format(self):
        """Test validation of metadata name format"""
        # This test verifies that invalid names are caught by Pydantic validation
        # before even reaching the validator
        with pytest.raises(Exception):  # Pydantic will raise ValidationError
            manifest = AgentManifest(
                manifest_version="1.0",
                metadata=AgentMetadata(
                    name="Test-Agent",  # Uppercase not allowed
                    display_name="Test Agent",
                    version="1.0.0",
                    description="A test agent"
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
    
    def test_validate_version_format(self):
        """Test validation warns on non-semver version"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0",  # Should be 1.0.0
                description="A test agent"
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
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        # Should have warning about version format
        version_warnings = [e for e in errors if 'version' in e.field.lower() and e.severity == 'warning']
        assert len(version_warnings) > 0
    
    def test_validate_short_description(self):
        """Test validation warns on short description"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="Short"  # Too short
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
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        # Should have warning about description length
        desc_warnings = [e for e in errors if 'description' in e.field.lower() and e.severity == 'warning']
        assert len(desc_warnings) > 0
    
    def test_validate_missing_author(self):
        """Test validation warns on missing author"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="A test agent description"
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
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        # Should have warning about missing author
        author_warnings = [e for e in errors if 'author' in e.field.lower() and e.severity == 'warning']
        assert len(author_warnings) > 0
    
    def test_validate_skill_examples(self):
        """Test validation warns on insufficient examples"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="A test agent"
            ),
            protocols=[AgentProtocol.A2A],
            skills=[
                AgentSkillSpec(
                    id="test_skill",
                    name="Test",
                    description="Test",
                    examples=["Only one"]  # Should have 3+
                )
            ]
        )
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        # Should have warning about examples
        example_warnings = [e for e in errors if 'example' in e.field.lower() and e.severity == 'warning']
        assert len(example_warnings) > 0
    
    def test_validate_openapi_dependency_url(self):
        """Test validation checks OpenAPI dependency has URL"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="A test agent"
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
                    source=DependencySource.OPENAPI,
                    name="my-api",
                    url="https://api.example.com/openapi.json"
                )
            ]
        )
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        # Should be valid
        assert is_valid is True
    
    def test_validate_api_key_env_var_warning(self):
        """Test validation warns if API key env var not in environment section"""
        manifest = AgentManifest(
            manifest_version="1.0",
            metadata=AgentMetadata(
                name="test",
                display_name="Test",
                version="1.0.0",
                description="A test agent"
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
                    source=DependencySource.OPENAPI,
                    name="my-api",
                    url="https://api.example.com/openapi.json",
                    api_key_env_var="MY_API_KEY"
                )
            ]
            # No environment variables defined
        )
        
        is_valid, errors = AgentManifestValidator.validate(manifest)
        # Should have warning about missing env var
        env_warnings = [e for e in errors if 'MY_API_KEY' in e.message and e.severity == 'warning']
        assert len(env_warnings) > 0
    
    def test_validation_error_string_representation(self):
        """Test ValidationError string representation"""
        error = ValidatorError("test.field", "Test message", "error")
        error_str = str(error)
        assert "ERROR" in error_str
        assert "test.field" in error_str
        assert "Test message" in error_str

