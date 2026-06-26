"""Model for Toollistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toollistresponse(BaseModel):
  """Toollistresponse model"""


class ToollistresponseResponse(APIResponse):
  """Response model for Toollistresponse"""

  data: Optional[Toollistresponse] = None


class ToollistresponseListResponse(APIResponse):
  """List response model for Toollistresponse"""

  data: List[Toollistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
