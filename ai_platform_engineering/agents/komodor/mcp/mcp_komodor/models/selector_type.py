"""Model for Selectortype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Selectortype(BaseModel):
  """Selectortype model"""


class SelectortypeResponse(APIResponse):
  """Response model for Selectortype"""

  data: Optional[Selectortype] = None


class SelectortypeListResponse(APIResponse):
  """List response model for Selectortype"""

  data: List[Selectortype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
