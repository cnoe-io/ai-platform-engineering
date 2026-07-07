"""Model for Pertestingcriteriaresult"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Pertestingcriteriaresult(BaseModel):
  """Results for a specific testing criteria"""


class PertestingcriteriaresultResponse(APIResponse):
  """Response model for Pertestingcriteriaresult"""

  data: Optional[Pertestingcriteriaresult] = None


class PertestingcriteriaresultListResponse(APIResponse):
  """List response model for Pertestingcriteriaresult"""

  data: List[Pertestingcriteriaresult] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
