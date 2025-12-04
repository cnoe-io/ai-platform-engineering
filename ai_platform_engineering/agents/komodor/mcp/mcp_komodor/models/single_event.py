"""Model for Singleevent"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singleevent(BaseModel):
  """Singleevent model"""


class SingleeventResponse(APIResponse):
  """Response model for Singleevent"""

  data: Optional[Singleevent] = None


class SingleeventListResponse(APIResponse):
  """List response model for Singleevent"""

  data: List[Singleevent] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
