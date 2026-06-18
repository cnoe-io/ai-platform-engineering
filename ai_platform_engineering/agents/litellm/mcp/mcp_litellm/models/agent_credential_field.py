"""Model for Agentcredentialfield"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentcredentialfield(BaseModel):
  """Agentcredentialfield model"""


class AgentcredentialfieldResponse(APIResponse):
  """Response model for Agentcredentialfield"""

  data: Optional[Agentcredentialfield] = None


class AgentcredentialfieldListResponse(APIResponse):
  """List response model for Agentcredentialfield"""

  data: List[Agentcredentialfield] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
