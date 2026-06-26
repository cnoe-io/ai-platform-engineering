"""Model for Memoryvictimevent"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Memoryvictimevent(BaseModel):
  """Memoryvictimevent model"""


class MemoryvictimeventResponse(APIResponse):
  """Response model for Memoryvictimevent"""

  data: Optional[Memoryvictimevent] = None


class MemoryvictimeventListResponse(APIResponse):
  """List response model for Memoryvictimevent"""

  data: List[Memoryvictimevent] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
