"""Model for Ssosettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Ssosettingsresponse(BaseModel):
  """Response model for SSO settings"""


class SsosettingsresponseResponse(APIResponse):
  """Response model for Ssosettingsresponse"""

  data: Optional[Ssosettingsresponse] = None


class SsosettingsresponseListResponse(APIResponse):
  """List response model for Ssosettingsresponse"""

  data: List[Ssosettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
