"""Model for Tooldetailresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tooldetailresponse(BaseModel):
  """Tooldetailresponse model"""


class TooldetailresponseResponse(APIResponse):
  """Response model for Tooldetailresponse"""

  data: Optional[Tooldetailresponse] = None


class TooldetailresponseListResponse(APIResponse):
  """List response model for Tooldetailresponse"""

  data: List[Tooldetailresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
