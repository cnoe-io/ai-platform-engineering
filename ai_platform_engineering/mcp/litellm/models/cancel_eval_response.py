"""Model for Cancelevalresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cancelevalresponse(BaseModel):
  """Response from cancelling an evaluation"""


class CancelevalresponseResponse(APIResponse):
  """Response model for Cancelevalresponse"""

  data: Optional[Cancelevalresponse] = None


class CancelevalresponseListResponse(APIResponse):
  """List response model for Cancelevalresponse"""

  data: List[Cancelevalresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
