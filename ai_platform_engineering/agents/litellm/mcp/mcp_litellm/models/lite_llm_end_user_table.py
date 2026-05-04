"""Model for LitellmEndusertable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmEndusertable(BaseModel):
  """LitellmEndusertable model"""


class LitellmEndusertableResponse(APIResponse):
  """Response model for LitellmEndusertable"""

  data: Optional[LitellmEndusertable] = None


class LitellmEndusertableListResponse(APIResponse):
  """List response model for LitellmEndusertable"""

  data: List[LitellmEndusertable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
