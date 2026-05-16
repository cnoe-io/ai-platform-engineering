"""Model for Contentfilteraction"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Contentfilteraction(BaseModel):
  """Action to take when content filter detects a match"""


class ContentfilteractionResponse(APIResponse):
  """Response model for Contentfilteraction"""

  data: Optional[Contentfilteraction] = None


class ContentfilteractionListResponse(APIResponse):
  """List response model for Contentfilteraction"""

  data: List[Contentfilteraction] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
