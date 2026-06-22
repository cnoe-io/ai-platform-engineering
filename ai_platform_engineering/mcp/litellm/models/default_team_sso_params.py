"""Model for Defaultteamssoparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Defaultteamssoparams(BaseModel):
  """Default parameters to apply when a new team is automatically created by LiteLLM via SSO Groups"""


class DefaultteamssoparamsResponse(APIResponse):
  """Response model for Defaultteamssoparams"""

  data: Optional[Defaultteamssoparams] = None


class DefaultteamssoparamsListResponse(APIResponse):
  """List response model for Defaultteamssoparams"""

  data: List[Defaultteamssoparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
