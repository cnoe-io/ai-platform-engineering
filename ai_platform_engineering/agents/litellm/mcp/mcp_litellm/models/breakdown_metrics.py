"""Model for Breakdownmetrics"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Breakdownmetrics(BaseModel):
  """Breakdown of spend by different dimensions"""


class BreakdownmetricsResponse(APIResponse):
  """Response model for Breakdownmetrics"""

  data: Optional[Breakdownmetrics] = None


class BreakdownmetricsListResponse(APIResponse):
  """List response model for Breakdownmetrics"""

  data: List[Breakdownmetrics] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
