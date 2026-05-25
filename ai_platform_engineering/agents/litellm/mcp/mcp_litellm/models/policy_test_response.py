"""Model for Policytestresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policytestresponse(BaseModel):
  """Response for /policy/test endpoint."""


class PolicytestresponseResponse(APIResponse):
  """Response model for Policytestresponse"""

  data: Optional[Policytestresponse] = None


class PolicytestresponseListResponse(APIResponse):
  """List response model for Policytestresponse"""

  data: List[Policytestresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
