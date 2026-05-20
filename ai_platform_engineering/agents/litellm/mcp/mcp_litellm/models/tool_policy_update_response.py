"""Model for Toolpolicyupdateresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolpolicyupdateresponse(BaseModel):
  """Toolpolicyupdateresponse model"""


class ToolpolicyupdateresponseResponse(APIResponse):
  """Response model for Toolpolicyupdateresponse"""

  data: Optional[Toolpolicyupdateresponse] = None


class ToolpolicyupdateresponseListResponse(APIResponse):
  """List response model for Toolpolicyupdateresponse"""

  data: List[Toolpolicyupdateresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
