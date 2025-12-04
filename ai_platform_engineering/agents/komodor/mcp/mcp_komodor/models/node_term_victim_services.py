"""Model for Nodetermvictimservices"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Nodetermvictimservices(BaseModel):
  """Nodetermvictimservices model"""


class NodetermvictimservicesResponse(APIResponse):
  """Response model for Nodetermvictimservices"""

  data: Optional[Nodetermvictimservices] = None


class NodetermvictimservicesListResponse(APIResponse):
  """List response model for Nodetermvictimservices"""

  data: List[Nodetermvictimservices] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
