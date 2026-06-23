"""Model for Agentextension"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentextension(BaseModel):
  """A declaration of a protocol extension supported by an Agent."""


class AgentextensionResponse(APIResponse):
  """Response model for Agentextension"""

  data: Optional[Agentextension] = None


class AgentextensionListResponse(APIResponse):
  """List response model for Agentextension"""

  data: List[Agentextension] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
