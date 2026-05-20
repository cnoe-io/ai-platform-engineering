"""Model for Cancelrunresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cancelrunresponse(BaseModel):
  """Response from cancelling a run"""


class CancelrunresponseResponse(APIResponse):
  """Response model for Cancelrunresponse"""

  data: Optional[Cancelrunresponse] = None


class CancelrunresponseListResponse(APIResponse):
  """List response model for Cancelrunresponse"""

  data: List[Cancelrunresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
