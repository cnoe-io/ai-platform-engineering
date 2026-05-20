"""Model for Agentcapabilities"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentcapabilities(BaseModel):
  """Defines optional capabilities supported by an agent."""


class AgentcapabilitiesResponse(APIResponse):
  """Response model for Agentcapabilities"""

  data: Optional[Agentcapabilities] = None


class AgentcapabilitiesListResponse(APIResponse):
  """List response model for Agentcapabilities"""

  data: List[Agentcapabilities] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
