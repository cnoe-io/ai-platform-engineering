"""Model for Policydbresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policydbresponse(BaseModel):
  """Response for a policy from the database."""


class PolicydbresponseResponse(APIResponse):
  """Response model for Policydbresponse"""

  data: Optional[Policydbresponse] = None


class PolicydbresponseListResponse(APIResponse):
  """List response model for Policydbresponse"""

  data: List[Policydbresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
