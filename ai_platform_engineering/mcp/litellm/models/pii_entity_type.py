"""Model for Piientitytype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Piientitytype(BaseModel):
  """Piientitytype model"""


class PiientitytypeResponse(APIResponse):
  """Response model for Piientitytype"""

  data: Optional[Piientitytype] = None


class PiientitytypeListResponse(APIResponse):
  """List response model for Piientitytype"""

  data: List[Piientitytype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
