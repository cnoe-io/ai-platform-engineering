"""Model for Agentcreateinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentcreateinfo(BaseModel):
  """Agentcreateinfo model"""


class AgentcreateinfoResponse(APIResponse):
  """Response model for Agentcreateinfo"""

  data: Optional[Agentcreateinfo] = None


class AgentcreateinfoListResponse(APIResponse):
  """List response model for Agentcreateinfo"""

  data: List[Agentcreateinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
