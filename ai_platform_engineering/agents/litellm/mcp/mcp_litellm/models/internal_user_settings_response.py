"""Model for Internalusersettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Internalusersettingsresponse(BaseModel):
  """Response model for internal user settings"""


class InternalusersettingsresponseResponse(APIResponse):
  """Response model for Internalusersettingsresponse"""

  data: Optional[Internalusersettingsresponse] = None


class InternalusersettingsresponseListResponse(APIResponse):
  """List response model for Internalusersettingsresponse"""

  data: List[Internalusersettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
