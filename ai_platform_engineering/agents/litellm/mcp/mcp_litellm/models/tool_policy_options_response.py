"""Model for Toolpolicyoptionsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolpolicyoptionsresponse(BaseModel):
  """Toolpolicyoptionsresponse model"""


class ToolpolicyoptionsresponseResponse(APIResponse):
  """Response model for Toolpolicyoptionsresponse"""

  data: Optional[Toolpolicyoptionsresponse] = None


class ToolpolicyoptionsresponseListResponse(APIResponse):
  """List response model for Toolpolicyoptionsresponse"""

  data: List[Toolpolicyoptionsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
