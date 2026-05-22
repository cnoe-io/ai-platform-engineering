"""Model for Fallbackresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Fallbackresponse(BaseModel):
  """Response model for fallback operations"""


class FallbackresponseResponse(APIResponse):
  """Response model for Fallbackresponse"""

  data: Optional[Fallbackresponse] = None


class FallbackresponseListResponse(APIResponse):
  """List response model for Fallbackresponse"""

  data: List[Fallbackresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
