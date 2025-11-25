"""Model for Monitortype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Monitortype(BaseModel):
  """Monitortype model"""


class MonitortypeResponse(APIResponse):
  """Response model for Monitortype"""

  data: Optional[Monitortype] = None


class MonitortypeListResponse(APIResponse):
  """List response model for Monitortype"""

  data: List[Monitortype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
