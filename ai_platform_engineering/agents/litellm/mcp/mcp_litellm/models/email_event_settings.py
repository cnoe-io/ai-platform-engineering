"""Model for Emaileventsettings"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Emaileventsettings(BaseModel):
  """Emaileventsettings model"""


class EmaileventsettingsResponse(APIResponse):
  """Response model for Emaileventsettings"""

  data: Optional[Emaileventsettings] = None


class EmaileventsettingsListResponse(APIResponse):
  """List response model for Emaileventsettings"""

  data: List[Emaileventsettings] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
