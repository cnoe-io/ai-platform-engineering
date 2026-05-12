"""Model for Agentresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentresponse(BaseModel):
  """Agentresponse model"""


class AgentresponseResponse(APIResponse):
  """Response model for Agentresponse"""

  data: Optional[Agentresponse] = None


class AgentresponseListResponse(APIResponse):
  """List response model for Agentresponse"""

  data: List[Agentresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
