"""Model for Blogpostsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blogpostsresponse(BaseModel):
  """Blogpostsresponse model"""


class BlogpostsresponseResponse(APIResponse):
  """Response model for Blogpostsresponse"""

  data: Optional[Blogpostsresponse] = None


class BlogpostsresponseListResponse(APIResponse):
  """List response model for Blogpostsresponse"""

  data: List[Blogpostsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
