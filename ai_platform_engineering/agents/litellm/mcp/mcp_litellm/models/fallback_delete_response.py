"""Model for Fallbackdeleteresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Fallbackdeleteresponse(BaseModel):
  """Response model for deleting fallbacks"""


class FallbackdeleteresponseResponse(APIResponse):
  """Response model for Fallbackdeleteresponse"""

  data: Optional[Fallbackdeleteresponse] = None


class FallbackdeleteresponseListResponse(APIResponse):
  """List response model for Fallbackdeleteresponse"""

  data: List[Fallbackdeleteresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
