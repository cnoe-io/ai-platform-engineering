"""Model for Toolusagelogsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolusagelogsresponse(BaseModel):
  """Toolusagelogsresponse model"""


class ToolusagelogsresponseResponse(APIResponse):
  """Response model for Toolusagelogsresponse"""

  data: Optional[Toolusagelogsresponse] = None


class ToolusagelogsresponseListResponse(APIResponse):
  """List response model for Toolusagelogsresponse"""

  data: List[Toolusagelogsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
