# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import json
from enum import Enum
from typing import Optional, TypedDict, Any, Dict, List, Callable

from pydantic import BaseModel, Field


class MsgType(Enum):
    human = "human"
    assistant = "assistant"


class Message(BaseModel):
    type: MsgType = Field(
        ...,
        description="indicates the originator of the message, a human or an assistant",
    )
    content: str = Field(..., description="the content of the message")


class ConfigSchema(TypedDict):
    to_upper: bool
    to_lower: bool


class InputState(BaseModel):
    messages: Optional[list[Message]] = None


class OutputState(BaseModel):
    messages: Optional[list[Message]] = None


class SafeJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder that safely handles non-serializable types."""
    def default(self, obj):
        # Handle functions
        if callable(obj):
            return f"<function {obj.__name__}>"
        
        # Handle other non-serializable types
        try:
            return super().default(obj)
        except TypeError:
            return f"<non-serializable: {type(obj).__name__}>"


class AgentState(BaseModel):
    slack_input: InputState
    slack_output: Optional[OutputState] = None

    # Required for LangGraph
    conversation_history: List[Dict[str, Any]] = []
    tools: Optional[List[Dict[str, Any]]] = None
    next_action: Optional[Dict[str, Any]] = None
    tool_results: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    
    def model_dump_json(self, **kwargs):
        """
        Override the model_dump_json method to safely handle function objects.
        """
        # First get a dict representation, excluding any kwargs
        data = self.model_dump(**kwargs)
        
        # Then convert to JSON with our safe encoder
        return json.dumps(data, cls=SafeJSONEncoder)
    
    def safe_model_dump(self, **kwargs):
        """
        A safe version of model_dump that handles function objects.
        """
        data = self.model_dump(**kwargs)
        
        # Clean the tools to make them serializable
        if 'tools' in data and data['tools']:
            for tool in data['tools']:
                if 'function' in tool and callable(tool['function']):
                    tool['function'] = f"<function {tool['function'].__name__}>"
        
        return data