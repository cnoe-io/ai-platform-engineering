# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Manifest Data Models

Defines the data structures for agent manifests.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator
from enum import Enum


class AgentProtocol(str, Enum):
    """Supported agent protocols"""
    A2A = "a2a"
    MCP = "mcp"
    BOTH = "both"


class AgentTransport(str, Enum):
    """Supported transport modes"""
    HTTP = "http"
    SSE = "sse"
    STDIO = "stdio"


class DependencySource(str, Enum):
    """Source of dependencies"""
    PYPI = "pypi"
    OPENAPI = "openapi"
    CUSTOM = "custom"


class AgentSkillSpec(BaseModel):
    """Agent skill specification"""
    id: str = Field(..., description="Unique identifier for the skill")
    name: str = Field(..., description="Human-readable skill name")
    description: str = Field(..., description="Detailed description of the skill")
    tags: List[str] = Field(default_factory=list, description="Tags for categorizing the skill")
    examples: List[str] = Field(default_factory=list, description="Example queries/commands for the skill")


class DependencySpec(BaseModel):
    """Dependency specification"""
    source: DependencySource = Field(..., description="Source of the dependency")
    name: str = Field(..., description="Name of the dependency")
    version: Optional[str] = Field(None, description="Version constraint (for PyPI packages)")
    url: Optional[str] = Field(None, description="URL for OpenAPI specs or custom sources")
    api_key_env_var: Optional[str] = Field(None, description="Environment variable name for API key")
    additional_config: Dict[str, Any] = Field(default_factory=dict, description="Additional configuration")


class EnvironmentVariable(BaseModel):
    """Environment variable specification"""
    name: str = Field(..., description="Environment variable name")
    description: str = Field(..., description="Description of the variable")
    required: bool = Field(True, description="Whether the variable is required")
    default: Optional[str] = Field(None, description="Default value")


class AgentMetadata(BaseModel):
    """Agent metadata"""
    name: str = Field(..., description="Agent name (lowercase, no spaces)")
    display_name: str = Field(..., description="Human-readable display name")
    version: str = Field("0.1.0", description="Agent version")
    description: str = Field(..., description="Detailed agent description")
    author: Optional[str] = Field(None, description="Agent author")
    author_email: Optional[str] = Field(None, description="Agent author email")
    license: str = Field("Apache-2.0", description="License identifier")
    tags: List[str] = Field(default_factory=list, description="Agent tags")

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate agent name format"""
        if not v:
            raise ValueError("Agent name cannot be empty")
        if not v.islower():
            raise ValueError("Agent name must be lowercase")
        if ' ' in v:
            raise ValueError("Agent name cannot contain spaces")
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError("Agent name can only contain alphanumeric characters, hyphens, and underscores")
        return v


class AgentManifest(BaseModel):
    """
    Complete agent manifest specification
    
    This is the root model for agent manifests that can be used to auto-generate agents.
    """
    manifest_version: str = Field("1.0", description="Manifest format version")
    metadata: AgentMetadata = Field(..., description="Agent metadata")
    protocols: List[AgentProtocol] = Field(..., description="Supported protocols")
    transports: List[AgentTransport] = Field(
        default_factory=lambda: [AgentTransport.HTTP],
        description="Supported transport modes"
    )
    skills: List[AgentSkillSpec] = Field(..., description="Agent skills")
    dependencies: List[DependencySpec] = Field(default_factory=list, description="Agent dependencies")
    environment: List[EnvironmentVariable] = Field(default_factory=list, description="Required environment variables")
    capabilities: Dict[str, bool] = Field(
        default_factory=lambda: {"streaming": True, "pushNotifications": True},
        description="Agent capabilities"
    )
    docker_config: Dict[str, Any] = Field(
        default_factory=lambda: {"base_image": "python:3.13-slim"},
        description="Docker configuration"
    )
    
    @model_validator(mode='after')
    def validate_manifest(self):
        """Cross-field validation"""
        # Ensure at least one skill is defined
        if not self.skills:
            raise ValueError("Agent must have at least one skill defined")
        
        # Validate protocol-transport compatibility
        if AgentProtocol.MCP in self.protocols:
            if AgentTransport.HTTP not in self.transports and AgentTransport.STDIO not in self.transports:
                raise ValueError("MCP protocol requires HTTP or STDIO transport")
        
        return self

    def to_dict(self) -> Dict[str, Any]:
        """Convert manifest to dictionary"""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentManifest":
        """Create manifest from dictionary"""
        return cls(**data)

