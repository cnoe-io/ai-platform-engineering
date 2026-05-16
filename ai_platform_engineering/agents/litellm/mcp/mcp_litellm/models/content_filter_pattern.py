"""Model for Contentfilterpattern"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Contentfilterpattern(BaseModel):
  """Represents a content filter pattern (prebuilt or custom regex)"""


class ContentfilterpatternResponse(APIResponse):
  """Response model for Contentfilterpattern"""

  data: Optional[Contentfilterpattern] = None


class ContentfilterpatternListResponse(APIResponse):
  """List response model for Contentfilterpattern"""

  data: List[Contentfilterpattern] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
