"""Model for Usageaichatrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Usageaichatrequest(BaseModel):
  """Usageaichatrequest model"""


class UsageaichatrequestResponse(APIResponse):
  """Response model for Usageaichatrequest"""

  data: Optional[Usageaichatrequest] = None


class UsageaichatrequestListResponse(APIResponse):
  """List response model for Usageaichatrequest"""

  data: List[Usageaichatrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
