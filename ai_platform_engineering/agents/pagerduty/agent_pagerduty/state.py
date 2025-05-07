# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from enum import Enum
from typing import List, Optional, TypedDict
from pydantic import BaseModel, Field

class MsgType(str, Enum):
    """Message type enum."""
    human = "human"
    assistant = "assistant"

class Message(BaseModel):
    """Message model."""
    type: MsgType
    content: str

class InputState(BaseModel):
    """Input state model."""
    messages: List[Message] = Field(default_factory=list)

class OutputState(BaseModel):
    """Output state model."""
    messages: List[Message] = Field(default_factory=list)

class ConfigSchema(TypedDict):
    to_upper: bool
    to_lower: bool

class AgentState(BaseModel):
    """Agent state model."""
    pagerduty_input: InputState
    pagerduty_output: Optional[OutputState] = None 