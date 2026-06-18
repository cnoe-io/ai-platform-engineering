"""Model for Policyversionlistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyversionlistresponse(BaseModel):
  """Response for listing all versions of a policy."""


class PolicyversionlistresponseResponse(APIResponse):
  """Response model for Policyversionlistresponse"""

  data: Optional[Policyversionlistresponse] = None


class PolicyversionlistresponseListResponse(APIResponse):
  """List response model for Policyversionlistresponse"""

  data: List[Policyversionlistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
