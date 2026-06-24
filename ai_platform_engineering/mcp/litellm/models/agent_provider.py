"""Model for Agentprovider"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentprovider(BaseModel):
  """Represents the service provider of an agent."""


class AgentproviderResponse(APIResponse):
  """Response model for Agentprovider"""

  data: Optional[Agentprovider] = None


class AgentproviderListResponse(APIResponse):
  """List response model for Agentprovider"""

  data: List[Agentprovider] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
