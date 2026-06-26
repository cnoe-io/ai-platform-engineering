"""Model for Activeusersanalyticsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Activeusersanalyticsresponse(BaseModel):
  """Response for active users analytics"""


class ActiveusersanalyticsresponseResponse(APIResponse):
  """Response model for Activeusersanalyticsresponse"""

  data: Optional[Activeusersanalyticsresponse] = None


class ActiveusersanalyticsresponseListResponse(APIResponse):
  """List response model for Activeusersanalyticsresponse"""

  data: List[Activeusersanalyticsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
