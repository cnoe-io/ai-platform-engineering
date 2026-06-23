"""Model for Tagsummarymetrics"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tagsummarymetrics(BaseModel):
  """Summary metrics for a tag"""


class TagsummarymetricsResponse(APIResponse):
  """Response model for Tagsummarymetrics"""

  data: Optional[Tagsummarymetrics] = None


class TagsummarymetricsListResponse(APIResponse):
  """List response model for Tagsummarymetrics"""

  data: List[Tagsummarymetrics] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
