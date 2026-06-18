"""Model for Usageoverviewresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Usageoverviewresponse(BaseModel):
  """Usageoverviewresponse model"""


class UsageoverviewresponseResponse(APIResponse):
  """Response model for Usageoverviewresponse"""

  data: Optional[Usageoverviewresponse] = None


class UsageoverviewresponseListResponse(APIResponse):
  """List response model for Usageoverviewresponse"""

  data: List[Usageoverviewresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
