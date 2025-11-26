"""Model for Costrightsizingsummary"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costrightsizingsummary(BaseModel):
  """A representation of a table row in right-sizing cost"""


class CostrightsizingsummaryResponse(APIResponse):
  """Response model for Costrightsizingsummary"""

  data: Optional[Costrightsizingsummary] = None


class CostrightsizingsummaryListResponse(APIResponse):
  """List response model for Costrightsizingsummary"""

  data: List[Costrightsizingsummary] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
