"""Model for Routersettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Routersettingsresponse(BaseModel):
  """Routersettingsresponse model"""


class RoutersettingsresponseResponse(APIResponse):
  """Response model for Routersettingsresponse"""

  data: Optional[Routersettingsresponse] = None


class RoutersettingsresponseListResponse(APIResponse):
  """List response model for Routersettingsresponse"""

  data: List[Routersettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
