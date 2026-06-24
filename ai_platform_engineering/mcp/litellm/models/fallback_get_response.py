"""Model for Fallbackgetresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Fallbackgetresponse(BaseModel):
  """Response model for getting fallbacks"""


class FallbackgetresponseResponse(APIResponse):
  """Response model for Fallbackgetresponse"""

  data: Optional[Fallbackgetresponse] = None


class FallbackgetresponseListResponse(APIResponse):
  """List response model for Fallbackgetresponse"""

  data: List[Fallbackgetresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
