"""Model for Searchissuesresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchissuesresponse(BaseModel):
  """Searchissuesresponse model"""


class SearchissuesresponseResponse(APIResponse):
  """Response model for Searchissuesresponse"""

  data: Optional[Searchissuesresponse] = None


class SearchissuesresponseListResponse(APIResponse):
  """List response model for Searchissuesresponse"""

  data: List[Searchissuesresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
