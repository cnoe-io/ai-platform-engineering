# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from enum import Enum
from typing import Optional, TypedDict
from typing import List, Dict, Any

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


class AgentState(BaseModel):
    slack_input: InputState
    slack_output: Optional[OutputState] = None
    conversation_history: List[Dict[str, Any]] = []
    tools: Optional[List[Dict[str, Any]]] = None
    next_action: Optional[Dict[str, Any]] = None
    tool_results: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None