# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Manifest Parser

Parses YAML/JSON agent manifests into structured data models.
"""

import yaml
import json
from pathlib import Path
from typing import Union, Dict, Any
from .models import AgentManifest


class AgentManifestParser:
    """Parser for agent manifest files"""
    
    @staticmethod
    def parse_file(manifest_path: Union[str, Path]) -> AgentManifest:
        """
        Parse an agent manifest file
        
        Args:
            manifest_path: Path to the manifest file (YAML or JSON)
            
        Returns:
            AgentManifest: Parsed and validated manifest
            
        Raises:
            FileNotFoundError: If manifest file doesn't exist
            ValueError: If manifest is invalid
            yaml.YAMLError: If YAML parsing fails
            json.JSONDecodeError: If JSON parsing fails
        """
        manifest_path = Path(manifest_path)
        
        if not manifest_path.exists():
            raise FileNotFoundError(f"Manifest file not found: {manifest_path}")
        
        # Read file content
        with open(manifest_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Parse based on file extension
        suffix = manifest_path.suffix.lower()
        
        if suffix in ['.yaml', '.yml']:
            data = yaml.safe_load(content)
        elif suffix == '.json':
            data = json.loads(content)
        else:
            # Try YAML first, then JSON
            try:
                data = yaml.safe_load(content)
            except yaml.YAMLError:
                data = json.loads(content)
        
        if not data:
            raise ValueError("Manifest file is empty")
        
        # Validate and create manifest object
        return AgentManifest.from_dict(data)
    
    @staticmethod
    def parse_string(manifest_content: str, format: str = 'yaml') -> AgentManifest:
        """
        Parse an agent manifest from string
        
        Args:
            manifest_content: Manifest content as string
            format: Format of the content ('yaml' or 'json')
            
        Returns:
            AgentManifest: Parsed and validated manifest
            
        Raises:
            ValueError: If manifest is invalid
        """
        if format.lower() in ['yaml', 'yml']:
            data = yaml.safe_load(manifest_content)
        elif format.lower() == 'json':
            data = json.loads(manifest_content)
        else:
            raise ValueError(f"Unsupported format: {format}")
        
        if not data:
            raise ValueError("Manifest content is empty")
        
        return AgentManifest.from_dict(data)
    
    @staticmethod
    def parse_dict(manifest_data: Dict[str, Any]) -> AgentManifest:
        """
        Parse an agent manifest from dictionary
        
        Args:
            manifest_data: Manifest data as dictionary
            
        Returns:
            AgentManifest: Parsed and validated manifest
        """
        return AgentManifest.from_dict(manifest_data)

