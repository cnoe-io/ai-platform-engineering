"""Model for Emaileventsettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Emaileventsettingsresponse(BaseModel):
  """Emaileventsettingsresponse model"""


class EmaileventsettingsresponseResponse(APIResponse):
  """Response model for Emaileventsettingsresponse"""

  data: Optional[Emaileventsettingsresponse] = None


class EmaileventsettingsresponseListResponse(APIResponse):
  """List response model for Emaileventsettingsresponse"""

  data: List[Emaileventsettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
