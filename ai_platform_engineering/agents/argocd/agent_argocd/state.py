# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from enum import Enum
from typing import Optional, TypedDict

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
    argocd_input: InputState
    argocd_output: Optional[OutputState] = None