"""Model for Peruseranalyticsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Peruseranalyticsresponse(BaseModel):
  """Response for per-user analytics"""


class PeruseranalyticsresponseResponse(APIResponse):
  """Response model for Peruseranalyticsresponse"""

  data: Optional[Peruseranalyticsresponse] = None


class PeruseranalyticsresponseListResponse(APIResponse):
  """List response model for Peruseranalyticsresponse"""

  data: List[Peruseranalyticsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
