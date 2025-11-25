"""Model for Epochtime"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Epochtime(BaseModel):
  """Unix timestamp in seconds"""


class EpochtimeResponse(APIResponse):
  """Response model for Epochtime"""

  data: Optional[Epochtime] = None


class EpochtimeListResponse(APIResponse):
  """List response model for Epochtime"""

  data: List[Epochtime] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
