"""Model for Policyinforesponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyinforesponse(BaseModel):
  """Response for /policy/info/{policy_name} endpoint."""


class PolicyinforesponseResponse(APIResponse):
  """Response model for Policyinforesponse"""

  data: Optional[Policyinforesponse] = None


class PolicyinforesponseListResponse(APIResponse):
  """List response model for Policyinforesponse"""

  data: List[Policyinforesponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
