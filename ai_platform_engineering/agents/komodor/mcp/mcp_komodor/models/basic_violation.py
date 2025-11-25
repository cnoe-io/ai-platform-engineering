"""Model for Basicviolation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Basicviolation(BaseModel):
  """Basicviolation model"""


class BasicviolationResponse(APIResponse):
  """Response model for Basicviolation"""

  data: Optional[Basicviolation] = None


class BasicviolationListResponse(APIResponse):
  """List response model for Basicviolation"""

  data: List[Basicviolation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
