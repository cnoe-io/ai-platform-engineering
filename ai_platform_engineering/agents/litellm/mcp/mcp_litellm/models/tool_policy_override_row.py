"""Model for Toolpolicyoverriderow"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolpolicyoverriderow(BaseModel):
  """Toolpolicyoverriderow model"""


class ToolpolicyoverriderowResponse(APIResponse):
  """Response model for Toolpolicyoverriderow"""

  data: Optional[Toolpolicyoverriderow] = None


class ToolpolicyoverriderowListResponse(APIResponse):
  """List response model for Toolpolicyoverriderow"""

  data: List[Toolpolicyoverriderow] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
