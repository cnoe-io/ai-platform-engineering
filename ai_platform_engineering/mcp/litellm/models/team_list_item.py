"""Model for Teamlistitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teamlistitem(BaseModel):
  """A team item in the paginated list response, enriched with computed fields."""


class TeamlistitemResponse(APIResponse):
  """Response model for Teamlistitem"""

  data: Optional[Teamlistitem] = None


class TeamlistitemListResponse(APIResponse):
  """List response model for Teamlistitem"""

  data: List[Teamlistitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
