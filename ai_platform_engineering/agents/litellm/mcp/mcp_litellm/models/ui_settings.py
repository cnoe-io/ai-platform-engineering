"""Model for Uisettings"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Uisettings(BaseModel):
  """Configuration for UI-specific flags"""


class UisettingsResponse(APIResponse):
  """Response model for Uisettings"""

  data: Optional[Uisettings] = None


class UisettingsListResponse(APIResponse):
  """List response model for Uisettings"""

  data: List[Uisettings] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
