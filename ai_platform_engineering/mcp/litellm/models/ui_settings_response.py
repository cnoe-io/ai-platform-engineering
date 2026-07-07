"""Model for Uisettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Uisettingsresponse(BaseModel):
  """Response model for UI settings"""


class UisettingsresponseResponse(APIResponse):
  """Response model for Uisettingsresponse"""

  data: Optional[Uisettingsresponse] = None


class UisettingsresponseListResponse(APIResponse):
  """List response model for Uisettingsresponse"""

  data: List[Uisettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
