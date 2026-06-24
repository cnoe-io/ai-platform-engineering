"""Model for Teamlistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teamlistresponse(BaseModel):
  """Response to get the list of teams"""


class TeamlistresponseResponse(APIResponse):
  """Response model for Teamlistresponse"""

  data: Optional[Teamlistresponse] = None


class TeamlistresponseListResponse(APIResponse):
  """List response model for Teamlistresponse"""

  data: List[Teamlistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
