"""Model for Userinfov2response"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userinfov2response(BaseModel):
  """Response model for GET /v2/user/info

  Returns ONLY the user object - no keys, no teams objects.
  This is a lightweight alternative to UserInfoResponse."""


class Userinfov2responseResponse(APIResponse):
  """Response model for Userinfov2response"""

  data: Optional[Userinfov2response] = None


class Userinfov2responseListResponse(APIResponse):
  """List response model for Userinfov2response"""

  data: List[Userinfov2response] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
