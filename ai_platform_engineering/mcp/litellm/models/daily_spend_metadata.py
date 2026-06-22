"""Model for Dailyspendmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Dailyspendmetadata(BaseModel):
  """Dailyspendmetadata model"""


class DailyspendmetadataResponse(APIResponse):
  """Response model for Dailyspendmetadata"""

  data: Optional[Dailyspendmetadata] = None


class DailyspendmetadataListResponse(APIResponse):
  """List response model for Dailyspendmetadata"""

  data: List[Dailyspendmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
