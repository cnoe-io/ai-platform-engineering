"""Model for Deleteevalresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteevalresponse(BaseModel):
  """Response from deleting an evaluation"""


class DeleteevalresponseResponse(APIResponse):
  """Response model for Deleteevalresponse"""

  data: Optional[Deleteevalresponse] = None


class DeleteevalresponseListResponse(APIResponse):
  """List response model for Deleteevalresponse"""

  data: List[Deleteevalresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
