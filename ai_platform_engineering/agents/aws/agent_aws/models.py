# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
from enum import Enum
from typing import Optional, List, Union
from pydantic import BaseModel, Field


class MessageType(str, Enum):
    """Message type enumeration."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class Message(BaseModel):
    """Conversation message model."""
    type: MessageType = Field(..., description="The type of message")
    content: str = Field(..., description="The content of the message")
    timestamp: Optional[str] = Field(None, description="Message timestamp")
    metadata: Optional[dict] = Field(default_factory=dict, description="Additional metadata")


class AgentConfig(BaseModel):
    """Configuration for the AWS EKS Agent."""
    agent_name: str = Field(default="aws-eks", description="Name of the agent")
    model_provider: Optional[str] = Field(None, description="Model provider (bedrock, openai, default)")
    model_name: Optional[str] = Field(None, description="Specific model name to use")
    aws_region: str = Field(default="us-west-2", description="Default AWS region")
    aws_profile: Optional[str] = Field(None, description="AWS profile to use")
    log_level: str = Field(default="INFO", description="Logging level")
    
    @classmethod
    def from_env(cls) -> 'AgentConfig':
        """Create configuration from environment variables."""
        # Use LLM_PROVIDER to match other agents in workspace
        model_provider = os.getenv("LLM_PROVIDER") or os.getenv("STRANDS_MODEL_PROVIDER")
        model_name = os.getenv("AZURE_OPENAI_DEPLOYMENT") or os.getenv("STRANDS_MODEL_NAME")
        
        return cls(
            agent_name=os.getenv("AWS_AGENT_NAME", "aws-eks"),
            model_provider=model_provider,
            model_name=model_name,
            aws_region=os.getenv("AWS_DEFAULT_REGION", "us-west-2"),
            aws_profile=os.getenv("AWS_PROFILE"),
            log_level=os.getenv("LOG_LEVEL", "INFO")
        )
    
    def get_model_config(self) -> Union[str, object, None]:
        """Get model configuration for Strands Agent creation."""
        
        if self.model_provider == "azure-openai":
            # For Azure OpenAI, let Strands use environment variables
            # We've set OPENAI_API_KEY and OPENAI_API_BASE which should work
            return None
        elif self.model_provider == "bedrock":
            # Return a bedrock model identifier
            model_name = self.model_name or "anthropic.claude-3-5-sonnet-20241022-v2:0"
            return f"bedrock:{model_name}"
        elif self.model_provider == "openai":
            # Return an openai model identifier
            model_name = self.model_name or "gpt-4o"
            return f"openai:{model_name}"
        else:
            # Default/fallback - let Strands decide based on environment
            return None
    enable_write_operations: bool = Field(default=True, description="Enable write operations")
    enable_sensitive_data_access: bool = Field(default=True, description="Enable sensitive data access")


class UserInputRequest(BaseModel):
    """An input that the user should provide for the agent to be able to take action."""
    field_name: str = Field(description="The name of the field that should be provided.")
    field_description: str = Field(
        description="A description of what this field represents and how it will be used."
    )
    field_values: List[str] = Field(
        description="A list of possible values that the user can provide for this field."
    )


class ResponseMetadata(BaseModel):
    """Metadata about the response from the AWS EKS Agent."""
    user_input: bool = Field(default=False, description="Indicates if the response requires user input")
    input_fields: List[UserInputRequest] = Field(default_factory=list, description="Required input fields")
    tools_used: int = Field(default=0, description="Number of tools available to the agent")
    conversation_length: int = Field(default=0, description="Length of current conversation")
    error: bool = Field(default=False, description="Whether an error occurred")
    error_message: Optional[str] = Field(None, description="Error message if applicable")


class AgentResponse(BaseModel):
    """Response from the AWS EKS Agent."""
    answer: str = Field(description="The response from the agent")
    metadata: ResponseMetadata = Field(description="Metadata about the response")


class ClusterInfo(BaseModel):
    """Information about an EKS cluster."""
    name: str = Field(description="Cluster name")
    status: str = Field(description="Cluster status")
    version: str = Field(description="Kubernetes version")
    endpoint: Optional[str] = Field(None, description="Cluster endpoint")
    region: str = Field(description="AWS region")
    created_at: Optional[str] = Field(None, description="Creation timestamp")


class KubernetesResource(BaseModel):
    """Information about a Kubernetes resource."""
    name: str = Field(description="Resource name")
    namespace: Optional[str] = Field(None, description="Resource namespace")
    kind: str = Field(description="Resource kind")
    api_version: str = Field(description="API version")
    status: Optional[str] = Field(None, description="Resource status")
    created_at: Optional[str] = Field(None, description="Creation timestamp")
