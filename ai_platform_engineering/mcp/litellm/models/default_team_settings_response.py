"""Model for Defaultteamsettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Defaultteamsettingsresponse(BaseModel):
  """Response model for default team settings"""


class DefaultteamsettingsresponseResponse(APIResponse):
  """Response model for Defaultteamsettingsresponse"""

  data: Optional[Defaultteamsettingsresponse] = None


class DefaultteamsettingsresponseListResponse(APIResponse):
  """List response model for Defaultteamsettingsresponse"""

  data: List[Defaultteamsettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
