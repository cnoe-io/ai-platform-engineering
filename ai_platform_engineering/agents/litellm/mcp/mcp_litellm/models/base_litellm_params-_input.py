"""Model for BaselitellmparamsInput"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BaselitellmparamsInput(BaseModel):
  """BaselitellmparamsInput model"""


class BaselitellmparamsInputResponse(APIResponse):
  """Response model for BaselitellmparamsInput"""

  data: Optional[BaselitellmparamsInput] = None


class BaselitellmparamsInputListResponse(APIResponse):
  """List response model for BaselitellmparamsInput"""

  data: List[BaselitellmparamsInput] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
