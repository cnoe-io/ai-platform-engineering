"""Model for Killeventtype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Killeventtype(BaseModel):
  """Killeventtype model"""


class KilleventtypeResponse(APIResponse):
  """Response model for Killeventtype"""

  data: Optional[Killeventtype] = None


class KilleventtypeListResponse(APIResponse):
  """List response model for Killeventtype"""

  data: List[Killeventtype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
