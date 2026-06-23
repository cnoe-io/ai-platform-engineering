"""Model for Sinks"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Sinks(BaseModel):
  """Sinks model"""


class SinksResponse(APIResponse):
  """Response model for Sinks"""

  data: Optional[Sinks] = None


class SinksListResponse(APIResponse):
  """List response model for Sinks"""

  data: List[Sinks] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
