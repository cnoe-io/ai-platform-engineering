"""Model for LitellmTooltablerow"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmTooltablerow(BaseModel):
  """LitellmTooltablerow model"""


class LitellmTooltablerowResponse(APIResponse):
  """Response model for LitellmTooltablerow"""

  data: Optional[LitellmTooltablerow] = None


class LitellmTooltablerowListResponse(APIResponse):
  """List response model for LitellmTooltablerow"""

  data: List[LitellmTooltablerow] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
