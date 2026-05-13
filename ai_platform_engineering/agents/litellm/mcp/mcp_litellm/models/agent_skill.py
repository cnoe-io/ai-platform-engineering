"""Model for Agentskill"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentskill(BaseModel):
  """Represents a distinct capability or function that an agent can perform."""


class AgentskillResponse(APIResponse):
  """Response model for Agentskill"""

  data: Optional[Agentskill] = None


class AgentskillListResponse(APIResponse):
  """List response model for Agentskill"""

  data: List[Agentskill] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
