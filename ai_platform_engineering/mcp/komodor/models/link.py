"""Model for Link"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Link(BaseModel):
  """A URL link to more information"""


class LinkResponse(APIResponse):
  """Response model for Link"""

  data: Optional[Link] = None


class LinkListResponse(APIResponse):
  """List response model for Link"""

  data: List[Link] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
