"""Model for AgentcardOutput"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class AgentcardOutput(BaseModel):
  """The AgentCard is a self-describing manifest for an agent.
  It provides essential metadata including the agent's identity, capabilities,
  skills, supported communication methods, and security requirements."""


class AgentcardOutputResponse(APIResponse):
  """Response model for AgentcardOutput"""

  data: Optional[AgentcardOutput] = None


class AgentcardOutputListResponse(APIResponse):
  """List response model for AgentcardOutput"""

  data: List[AgentcardOutput] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
