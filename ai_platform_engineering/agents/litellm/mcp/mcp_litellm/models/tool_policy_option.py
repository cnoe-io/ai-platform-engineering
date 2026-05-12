"""Model for Toolpolicyoption"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolpolicyoption(BaseModel):
  """Toolpolicyoption model"""


class ToolpolicyoptionResponse(APIResponse):
  """Response model for Toolpolicyoption"""

  data: Optional[Toolpolicyoption] = None


class ToolpolicyoptionListResponse(APIResponse):
  """List response model for Toolpolicyoption"""

  data: List[Toolpolicyoption] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
