# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal

class Message(BaseModel):
    """Message between agents."""
    type: Literal["human", "assistant"] = Field(description="Message type")
    content: str = Field(description="Message content")

class MsgType:
    """Message type constants."""
    human = "human"
    assistant = "assistant"

class InputState(BaseModel):
    """Input state to the agent."""
    messages: List[Message] = Field(default_factory=list, description="Messages from human or other agents")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional metadata")

class OutputState(BaseModel):
    """Output state from the agent."""
    messages: List[Message] = Field(default_factory=list, description="Messages from human or agents, including new ones")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional metadata")

class AgentState(BaseModel):
    """State container for the agent."""
    slack_input: InputState = Field(default_factory=InputState, description="Input state to the agent")
    slack_output: Optional[OutputState] = Field(default=None, description="Output state from the agent")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Metadata for the agent")
    next_action: Optional[str] = Field(default=None, description="Next action to take")
    
    def safe_model_dump(self) -> Dict[str, Any]:
        """Safely dump the model to a dictionary, handling sensitive data."""
        data = self.model_dump()
        # Safe handling of sensitive data in metadata if needed
        if "metadata" in data and "env" in data["metadata"]:
            if "AZURE_OPENAI_API_KEY" in data["metadata"]["env"]:
                data["metadata"]["env"]["AZURE_OPENAI_API_KEY"] = "***REDACTED***"
            if "SLACK_BOT_TOKEN" in data["metadata"]["env"]:
                data["metadata"]["env"]["SLACK_BOT_TOKEN"] = "***REDACTED***"
        return data