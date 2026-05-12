"""Model for Agentmakepublicresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Agentmakepublicresponse(BaseModel):
  """Agentmakepublicresponse model"""


class AgentmakepublicresponseResponse(APIResponse):
  """Response model for Agentmakepublicresponse"""

  data: Optional[Agentmakepublicresponse] = None


class AgentmakepublicresponseListResponse(APIResponse):
  """List response model for Agentmakepublicresponse"""

  data: List[Agentmakepublicresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
