"""Model for Fallbackcreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Fallbackcreaterequest(BaseModel):
  """Request model for creating/updating fallbacks"""


class FallbackcreaterequestResponse(APIResponse):
  """Response model for Fallbackcreaterequest"""

  data: Optional[Fallbackcreaterequest] = None


class FallbackcreaterequestListResponse(APIResponse):
  """List response model for Fallbackcreaterequest"""

  data: List[Fallbackcreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
