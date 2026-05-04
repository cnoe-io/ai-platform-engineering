"""Model for LitellmModeltable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmModeltable(BaseModel):
  """LitellmModeltable model"""


class LitellmModeltableResponse(APIResponse):
  """Response model for LitellmModeltable"""

  data: Optional[LitellmModeltable] = None


class LitellmModeltableListResponse(APIResponse):
  """List response model for LitellmModeltable"""

  data: List[LitellmModeltable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
