"""Model for Checktype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Checktype(BaseModel):
  """Checktype model"""


class ChecktypeResponse(APIResponse):
  """Response model for Checktype"""

  data: Optional[Checktype] = None


class ChecktypeListResponse(APIResponse):
  """List response model for Checktype"""

  data: List[Checktype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
