"""Model for Spendmetrics"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Spendmetrics(BaseModel):
  """Spendmetrics model"""


class SpendmetricsResponse(APIResponse):
  """Response model for Spendmetrics"""

  data: Optional[Spendmetrics] = None


class SpendmetricsListResponse(APIResponse):
  """List response model for Spendmetrics"""

  data: List[Spendmetrics] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
