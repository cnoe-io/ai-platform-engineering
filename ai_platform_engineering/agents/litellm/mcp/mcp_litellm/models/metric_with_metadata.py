"""Model for Metricwithmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Metricwithmetadata(BaseModel):
  """Metricwithmetadata model"""


class MetricwithmetadataResponse(APIResponse):
  """Response model for Metricwithmetadata"""

  data: Optional[Metricwithmetadata] = None


class MetricwithmetadataListResponse(APIResponse):
  """List response model for Metricwithmetadata"""

  data: List[Metricwithmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
