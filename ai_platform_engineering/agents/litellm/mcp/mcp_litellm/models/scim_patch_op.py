"""Model for Scimpatchop"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimpatchop(BaseModel):
  """Scimpatchop model"""


class ScimpatchopResponse(APIResponse):
  """Response model for Scimpatchop"""

  data: Optional[Scimpatchop] = None


class ScimpatchopListResponse(APIResponse):
  """List response model for Scimpatchop"""

  data: List[Scimpatchop] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
