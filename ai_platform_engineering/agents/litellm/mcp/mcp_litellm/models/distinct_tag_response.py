"""Model for Distincttagresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Distincttagresponse(BaseModel):
  """Response for distinct user agent tags"""


class DistincttagresponseResponse(APIResponse):
  """Response model for Distincttagresponse"""

  data: Optional[Distincttagresponse] = None


class DistincttagresponseListResponse(APIResponse):
  """List response model for Distincttagresponse"""

  data: List[Distincttagresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
