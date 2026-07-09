"""Model for Uithemesettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Uithemesettingsresponse(BaseModel):
  """Response model for UI theme settings"""


class UithemesettingsresponseResponse(APIResponse):
  """Response model for Uithemesettingsresponse"""

  data: Optional[Uithemesettingsresponse] = None


class UithemesettingsresponseListResponse(APIResponse):
  """List response model for Uithemesettingsresponse"""

  data: List[Uithemesettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
