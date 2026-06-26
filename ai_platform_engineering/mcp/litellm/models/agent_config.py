"""Model for Agentconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentconfig(BaseModel):
  """Agentconfig model"""


class AgentconfigResponse(APIResponse):
  """Response model for Agentconfig"""

  data: Optional[Agentconfig] = None


class AgentconfigListResponse(APIResponse):
  """List response model for Agentconfig"""

  data: List[Agentconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
