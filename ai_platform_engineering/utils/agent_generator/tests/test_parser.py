# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Tests for manifest parser
"""

import pytest
import tempfile
import yaml
import json
from pathlib import Path
from ai_platform_engineering.utils.agent_generator.manifest_parser import AgentManifestParser
from ai_platform_engineering.utils.agent_generator.models import AgentManifest


class TestAgentManifestParser:
    """Tests for AgentManifestParser"""
    
    @pytest.fixture
    def valid_manifest_dict(self):
        """Fixture providing a valid manifest dictionary"""
        return {
            'manifest_version': '1.0',
            'metadata': {
                'name': 'test_agent',
                'display_name': 'Test Agent',
                'version': '1.0.0',
                'description': 'A test agent for unit testing'
            },
            'protocols': ['a2a'],
            'skills': [
                {
                    'id': 'test_skill',
                    'name': 'Test Skill',
                    'description': 'A test skill',
                    'examples': ['Example 1', 'Example 2']
                }
            ]
        }
    
    def test_parse_yaml_file(self, valid_manifest_dict):
        """Test parsing YAML file"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(valid_manifest_dict, f)
            temp_path = f.name
        
        try:
            manifest = AgentManifestParser.parse_file(temp_path)
            assert isinstance(manifest, AgentManifest)
            assert manifest.metadata.name == 'test_agent'
        finally:
            Path(temp_path).unlink()
    
    def test_parse_json_file(self, valid_manifest_dict):
        """Test parsing JSON file"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(valid_manifest_dict, f)
            temp_path = f.name
        
        try:
            manifest = AgentManifestParser.parse_file(temp_path)
            assert isinstance(manifest, AgentManifest)
            assert manifest.metadata.name == 'test_agent'
        finally:
            Path(temp_path).unlink()
    
    def test_parse_nonexistent_file(self):
        """Test parsing nonexistent file raises FileNotFoundError"""
        with pytest.raises(FileNotFoundError):
            AgentManifestParser.parse_file('/nonexistent/file.yaml')
    
    def test_parse_empty_file(self):
        """Test parsing empty file raises ValueError"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write('')
            temp_path = f.name
        
        try:
            with pytest.raises(ValueError, match="empty"):
                AgentManifestParser.parse_file(temp_path)
        finally:
            Path(temp_path).unlink()
    
    def test_parse_string_yaml(self, valid_manifest_dict):
        """Test parsing manifest from YAML string"""
        yaml_content = yaml.dump(valid_manifest_dict)
        manifest = AgentManifestParser.parse_string(yaml_content, format='yaml')
        assert isinstance(manifest, AgentManifest)
        assert manifest.metadata.name == 'test_agent'
    
    def test_parse_string_json(self, valid_manifest_dict):
        """Test parsing manifest from JSON string"""
        json_content = json.dumps(valid_manifest_dict)
        manifest = AgentManifestParser.parse_string(json_content, format='json')
        assert isinstance(manifest, AgentManifest)
        assert manifest.metadata.name == 'test_agent'
    
    def test_parse_string_invalid_format(self):
        """Test parsing with invalid format raises ValueError"""
        with pytest.raises(ValueError, match="Unsupported format"):
            AgentManifestParser.parse_string("content", format='xml')
    
    def test_parse_dict(self, valid_manifest_dict):
        """Test parsing manifest from dictionary"""
        manifest = AgentManifestParser.parse_dict(valid_manifest_dict)
        assert isinstance(manifest, AgentManifest)
        assert manifest.metadata.name == 'test_agent'
    
    def test_parse_invalid_manifest(self):
        """Test parsing invalid manifest raises ValidationError"""
        invalid_dict = {
            'manifest_version': '1.0',
            # Missing required fields
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(invalid_dict, f)
            temp_path = f.name
        
        try:
            with pytest.raises(Exception):  # Should raise validation error
                AgentManifestParser.parse_file(temp_path)
        finally:
            Path(temp_path).unlink()

