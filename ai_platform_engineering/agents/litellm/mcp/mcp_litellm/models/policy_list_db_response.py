"""Model for Policylistdbresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policylistdbresponse(BaseModel):
  """Response for listing policies from the database."""


class PolicylistdbresponseResponse(APIResponse):
  """Response model for Policylistdbresponse"""

  data: Optional[Policylistdbresponse] = None


class PolicylistdbresponseListResponse(APIResponse):
  """List response model for Policylistdbresponse"""

  data: List[Policylistdbresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
