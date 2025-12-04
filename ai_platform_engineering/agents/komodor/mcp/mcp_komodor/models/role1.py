"""Model for Role1"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Role1(BaseModel):
  """Role1 model"""


class Role1Response(APIResponse):
  """Response model for Role1"""

  data: Optional[Role1] = None


class Role1ListResponse(APIResponse):
  """List response model for Role1"""

  data: List[Role1] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
