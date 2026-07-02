"""Model for Defaultinternaluserparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Defaultinternaluserparams(BaseModel):
  """Default parameters to apply when a new user signs in via SSO or is created on the /user/new API endpoint"""


class DefaultinternaluserparamsResponse(APIResponse):
  """Response model for Defaultinternaluserparams"""

  data: Optional[Defaultinternaluserparams] = None


class DefaultinternaluserparamsListResponse(APIResponse):
  """List response model for Defaultinternaluserparams"""

  data: List[Defaultinternaluserparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
