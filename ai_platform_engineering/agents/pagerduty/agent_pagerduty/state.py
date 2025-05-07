# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class MsgType(str, Enum):
    """Message type enum."""
    HUMAN = "human"
    ASSISTANT = "assistant"

class Message(BaseModel):
    """Message model."""
    type: MsgType
    content: str

class InputState(BaseModel):
    """Input state model."""
    messages: List[Message]

class OutputState(BaseModel):
    """Output state model."""
    messages: List[Message]

class AgentState(BaseModel):
    """Agent state model."""
    messages: List[Message]
    config: Optional[Dict[str, Any]] = None 