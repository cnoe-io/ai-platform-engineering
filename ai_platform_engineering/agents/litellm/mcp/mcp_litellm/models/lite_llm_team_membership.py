"""Model for LitellmTeammembership"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmTeammembership(BaseModel):
  """LitellmTeammembership model"""


class LitellmTeammembershipResponse(APIResponse):
  """Response model for LitellmTeammembership"""

  data: Optional[LitellmTeammembership] = None


class LitellmTeammembershipListResponse(APIResponse):
  """List response model for LitellmTeammembership"""

  data: List[LitellmTeammembership] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
