"""Model for Singlejob"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singlejob(BaseModel):
  """Singlejob model"""


class SinglejobResponse(APIResponse):
  """Response model for Singlejob"""

  data: Optional[Singlejob] = None


class SinglejobListResponse(APIResponse):
  """List response model for Singlejob"""

  data: List[Singlejob] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
