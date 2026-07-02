"""Model for Tagsummaryresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tagsummaryresponse(BaseModel):
  """Response for tag summary analytics"""


class TagsummaryresponseResponse(APIResponse):
  """Response model for Tagsummaryresponse"""

  data: Optional[Tagsummaryresponse] = None


class TagsummaryresponseListResponse(APIResponse):
  """List response model for Tagsummaryresponse"""

  data: List[Tagsummaryresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
