"""Model for Distincttagsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Distincttagsresponse(BaseModel):
  """Response for all distinct user agent tags"""


class DistincttagsresponseResponse(APIResponse):
  """Response model for Distincttagsresponse"""

  data: Optional[Distincttagsresponse] = None


class DistincttagsresponseListResponse(APIResponse):
  """List response model for Distincttagsresponse"""

  data: List[Distincttagsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
