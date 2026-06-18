"""Model for LitellmSpendlogs"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmSpendlogs(BaseModel):
  """LitellmSpendlogs model"""


class LitellmSpendlogsResponse(APIResponse):
  """Response model for LitellmSpendlogs"""

  data: Optional[LitellmSpendlogs] = None


class LitellmSpendlogsListResponse(APIResponse):
  """List response model for LitellmSpendlogs"""

  data: List[LitellmSpendlogs] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
