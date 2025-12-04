"""Model for Minimalaction"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Minimalaction(BaseModel):
  """Minimalaction model"""


class MinimalactionResponse(APIResponse):
  """Response model for Minimalaction"""

  data: Optional[Minimalaction] = None


class MinimalactionListResponse(APIResponse):
  """List response model for Minimalaction"""

  data: List[Minimalaction] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
