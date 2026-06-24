"""Model for Agentcardsignature"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentcardsignature(BaseModel):
  """Represents a JWS signature of an AgentCard."""


class AgentcardsignatureResponse(APIResponse):
  """Response model for Agentcardsignature"""

  data: Optional[Agentcardsignature] = None


class AgentcardsignatureListResponse(APIResponse):
  """List response model for Agentcardsignature"""

  data: List[Agentcardsignature] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
