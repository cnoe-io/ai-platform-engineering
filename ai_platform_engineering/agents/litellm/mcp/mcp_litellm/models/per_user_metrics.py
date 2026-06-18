"""Model for Perusermetrics"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Perusermetrics(BaseModel):
  """Metrics for individual user"""


class PerusermetricsResponse(APIResponse):
  """Response model for Perusermetrics"""

  data: Optional[Perusermetrics] = None


class PerusermetricsListResponse(APIResponse):
  """List response model for Perusermetrics"""

  data: List[Perusermetrics] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
