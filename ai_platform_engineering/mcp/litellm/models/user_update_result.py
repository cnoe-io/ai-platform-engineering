"""Model for Userupdateresult"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userupdateresult(BaseModel):
  """Result of a single user update operation"""


class UserupdateresultResponse(APIResponse):
  """Response model for Userupdateresult"""

  data: Optional[Userupdateresult] = None


class UserupdateresultListResponse(APIResponse):
  """List response model for Userupdateresult"""

  data: List[Userupdateresult] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
