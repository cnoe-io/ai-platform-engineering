"""Model for Listskillsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listskillsresponse(BaseModel):
  """Response from listing skills"""


class ListskillsresponseResponse(APIResponse):
  """Response model for Listskillsresponse"""

  data: Optional[Listskillsresponse] = None


class ListskillsresponseListResponse(APIResponse):
  """List response model for Listskillsresponse"""

  data: List[Listskillsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
