"""Model for Resetspendrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Resetspendrequest(BaseModel):
  """Resetspendrequest model"""


class ResetspendrequestResponse(APIResponse):
  """Response model for Resetspendrequest"""

  data: Optional[Resetspendrequest] = None


class ResetspendrequestListResponse(APIResponse):
  """List response model for Resetspendrequest"""

  data: List[Resetspendrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
