# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from pydantic import BaseModel
from typing import Literal, Optional


class UserPrompt(BaseModel):
  prompt: str


class Input(BaseModel):
  """
  Represents the input for the A2A remote client.
  This class is used to structure the input payload for the A2A agent.
  """
  prompt: str
  trace_id: Optional[str] = None


class Output(BaseModel):
  """
  Represents the output of the A2A remote client.
  This class is used to structure the response from the A2A agent.
  """
  response: str

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str