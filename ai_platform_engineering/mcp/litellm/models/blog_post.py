"""Model for Blogpost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blogpost(BaseModel):
  """Blogpost model"""


class BlogpostResponse(APIResponse):
  """Response model for Blogpost"""

  data: Optional[Blogpost] = None


class BlogpostListResponse(APIResponse):
  """List response model for Blogpost"""

  data: List[Blogpost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
