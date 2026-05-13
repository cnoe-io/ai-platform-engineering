"""Model for Dailyspenddata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Dailyspenddata(BaseModel):
  """Dailyspenddata model"""


class DailyspenddataResponse(APIResponse):
  """Response model for Dailyspenddata"""

  data: Optional[Dailyspenddata] = None


class DailyspenddataListResponse(APIResponse):
  """List response model for Dailyspenddata"""

  data: List[Dailyspenddata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
