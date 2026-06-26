"""Model for Vantageinitresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantageinitresponse(BaseModel):
  """Response model for Vantage initialization"""


class VantageinitresponseResponse(APIResponse):
  """Response model for Vantageinitresponse"""

  data: Optional[Vantageinitresponse] = None


class VantageinitresponseListResponse(APIResponse):
  """List response model for Vantageinitresponse"""

  data: List[Vantageinitresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
