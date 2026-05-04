"""Model for Usagedetailresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Usagedetailresponse(BaseModel):
  """Usagedetailresponse model"""


class UsagedetailresponseResponse(APIResponse):
  """Response model for Usagedetailresponse"""

  data: Optional[Usagedetailresponse] = None


class UsagedetailresponseListResponse(APIResponse):
  """List response model for Usagedetailresponse"""

  data: List[Usagedetailresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
