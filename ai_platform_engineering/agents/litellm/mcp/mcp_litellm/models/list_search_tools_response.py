"""Model for Listsearchtoolsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listsearchtoolsresponse(BaseModel):
  """Response model for listing search tools."""


class ListsearchtoolsresponseResponse(APIResponse):
  """Response model for Listsearchtoolsresponse"""

  data: Optional[Listsearchtoolsresponse] = None


class ListsearchtoolsresponseListResponse(APIResponse):
  """List response model for Listsearchtoolsresponse"""

  data: List[Listsearchtoolsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
