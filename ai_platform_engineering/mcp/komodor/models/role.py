"""Model for Role"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Role(BaseModel):
  """Role model"""


class RoleResponse(APIResponse):
  """Response model for Role"""

  data: Optional[Role] = None


class RoleListResponse(APIResponse):
  """List response model for Role"""

  data: List[Role] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
