"""Model for Errorresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Errorresponse(BaseModel):
  """Errorresponse model"""


class ErrorresponseResponse(APIResponse):
  """Response model for Errorresponse"""

  data: Optional[Errorresponse] = None


class ErrorresponseListResponse(APIResponse):
  """List response model for Errorresponse"""

  data: List[Errorresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
