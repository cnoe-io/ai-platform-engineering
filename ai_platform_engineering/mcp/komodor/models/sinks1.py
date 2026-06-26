"""Model for Sinks1"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Sinks1(BaseModel):
  """Sinks1 model"""


class Sinks1Response(APIResponse):
  """Response model for Sinks1"""

  data: Optional[Sinks1] = None


class Sinks1ListResponse(APIResponse):
  """List response model for Sinks1"""

  data: List[Sinks1] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
