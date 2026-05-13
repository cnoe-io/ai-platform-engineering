"""Model for BaselitellmparamsOutput"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BaselitellmparamsOutput(BaseModel):
  """BaselitellmparamsOutput model"""


class BaselitellmparamsOutputResponse(APIResponse):
  """Response model for BaselitellmparamsOutput"""

  data: Optional[BaselitellmparamsOutput] = None


class BaselitellmparamsOutputListResponse(APIResponse):
  """List response model for BaselitellmparamsOutput"""

  data: List[BaselitellmparamsOutput] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
