"""Model for Searchtoolinforesponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchtoolinforesponse(BaseModel):
  """Response model for search tool information."""


class SearchtoolinforesponseResponse(APIResponse):
  """Response model for Searchtoolinforesponse"""

  data: Optional[Searchtoolinforesponse] = None


class SearchtoolinforesponseListResponse(APIResponse):
  """List response model for Searchtoolinforesponse"""

  data: List[Searchtoolinforesponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
