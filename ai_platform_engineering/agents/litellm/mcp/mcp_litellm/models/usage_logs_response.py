"""Model for Usagelogsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Usagelogsresponse(BaseModel):
  """Usagelogsresponse model"""


class UsagelogsresponseResponse(APIResponse):
  """Response model for Usagelogsresponse"""

  data: Optional[Usagelogsresponse] = None


class UsagelogsresponseListResponse(APIResponse):
  """List response model for Usagelogsresponse"""

  data: List[Usagelogsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
