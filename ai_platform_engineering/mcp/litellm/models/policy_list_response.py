"""Model for Policylistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policylistresponse(BaseModel):
  """Response for /policy/list endpoint."""


class PolicylistresponseResponse(APIResponse):
  """Response model for Policylistresponse"""

  data: Optional[Policylistresponse] = None


class PolicylistresponseListResponse(APIResponse):
  """List response model for Policylistresponse"""

  data: List[Policylistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
