"""Model for Costallocationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costallocationresponse(BaseModel):
  """Costallocationresponse model"""


class CostallocationresponseResponse(APIResponse):
  """Response model for Costallocationresponse"""

  data: Optional[Costallocationresponse] = None


class CostallocationresponseListResponse(APIResponse):
  """List response model for Costallocationresponse"""

  data: List[Costallocationresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
