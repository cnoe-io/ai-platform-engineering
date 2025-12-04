"""Model for Sinksoptions"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Sinksoptions(BaseModel):
  """Sinksoptions model"""


class SinksoptionsResponse(APIResponse):
  """Response model for Sinksoptions"""

  data: Optional[Sinksoptions] = None


class SinksoptionsListResponse(APIResponse):
  """List response model for Sinksoptions"""

  data: List[Sinksoptions] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
