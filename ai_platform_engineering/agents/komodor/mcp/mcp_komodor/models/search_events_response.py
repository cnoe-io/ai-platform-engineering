"""Model for Searcheventsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searcheventsresponse(BaseModel):
  """A list of events matching the search criteria"""


class SearcheventsresponseResponse(APIResponse):
  """Response model for Searcheventsresponse"""

  data: Optional[Searcheventsresponse] = None


class SearcheventsresponseListResponse(APIResponse):
  """List response model for Searcheventsresponse"""

  data: List[Searcheventsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
