"""Model for Usageoverviewrow"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Usageoverviewrow(BaseModel):
  """Usageoverviewrow model"""


class UsageoverviewrowResponse(APIResponse):
  """Response model for Usageoverviewrow"""

  data: Optional[Usageoverviewrow] = None


class UsageoverviewrowListResponse(APIResponse):
  """List response model for Usageoverviewrow"""

  data: List[Usageoverviewrow] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
