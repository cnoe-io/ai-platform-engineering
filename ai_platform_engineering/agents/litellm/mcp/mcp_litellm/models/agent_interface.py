"""Model for Agentinterface"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentinterface(BaseModel):
  """Declares a combination of a target URL and a transport protocol."""


class AgentinterfaceResponse(APIResponse):
  """Response model for Agentinterface"""

  data: Optional[Agentinterface] = None


class AgentinterfaceListResponse(APIResponse):
  """List response model for Agentinterface"""

  data: List[Agentinterface] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
