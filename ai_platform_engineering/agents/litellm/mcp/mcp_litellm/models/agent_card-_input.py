"""Model for AgentcardInput"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class AgentcardInput(BaseModel):
  """The AgentCard is a self-describing manifest for an agent.
  It provides essential metadata including the agent's identity, capabilities,
  skills, supported communication methods, and security requirements."""


class AgentcardInputResponse(APIResponse):
  """Response model for AgentcardInput"""

  data: Optional[AgentcardInput] = None


class AgentcardInputListResponse(APIResponse):
  """List response model for AgentcardInput"""

  data: List[AgentcardInput] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
