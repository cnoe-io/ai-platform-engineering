"""Model for Policymatchcontext"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policymatchcontext(BaseModel):
  """Context used to match a request against policies.

  Contains the team alias, key alias, and model from the incoming request."""


class PolicymatchcontextResponse(APIResponse):
  """Response model for Policymatchcontext"""

  data: Optional[Policymatchcontext] = None


class PolicymatchcontextListResponse(APIResponse):
  """List response model for Policymatchcontext"""

  data: List[Policymatchcontext] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
