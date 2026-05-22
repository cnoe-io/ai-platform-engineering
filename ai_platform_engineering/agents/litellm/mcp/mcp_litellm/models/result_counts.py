"""Model for Resultcounts"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Resultcounts(BaseModel):
  """Result counts for a run"""


class ResultcountsResponse(APIResponse):
  """Response model for Resultcounts"""

  data: Optional[Resultcounts] = None


class ResultcountsListResponse(APIResponse):
  """List response model for Resultcounts"""

  data: List[Resultcounts] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
