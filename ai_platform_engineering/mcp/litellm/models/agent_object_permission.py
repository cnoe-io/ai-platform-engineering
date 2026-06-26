"""Model for Agentobjectpermission"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentobjectpermission(BaseModel):
  """Agentobjectpermission model"""


class AgentobjectpermissionResponse(APIResponse):
  """Response model for Agentobjectpermission"""

  data: Optional[Agentobjectpermission] = None


class AgentobjectpermissionListResponse(APIResponse):
  """List response model for Agentobjectpermission"""

  data: List[Agentobjectpermission] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
