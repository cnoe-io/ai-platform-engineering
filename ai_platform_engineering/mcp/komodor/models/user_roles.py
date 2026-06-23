"""Model for Userroles"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userroles(BaseModel):
  """Userroles model"""


class UserrolesResponse(APIResponse):
  """Response model for Userroles"""

  data: Optional[Userroles] = None


class UserrolesListResponse(APIResponse):
  """List response model for Userroles"""

  data: List[Userroles] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
