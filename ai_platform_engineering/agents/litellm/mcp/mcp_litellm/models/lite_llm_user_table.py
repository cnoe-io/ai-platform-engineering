"""Model for LitellmUsertable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmUsertable(BaseModel):
  """LitellmUsertable model"""


class LitellmUsertableResponse(APIResponse):
  """Response model for LitellmUsertable"""

  data: Optional[LitellmUsertable] = None


class LitellmUsertableListResponse(APIResponse):
  """List response model for LitellmUsertable"""

  data: List[LitellmUsertable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
