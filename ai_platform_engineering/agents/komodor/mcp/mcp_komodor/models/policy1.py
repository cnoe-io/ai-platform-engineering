"""Model for Policy1"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policy1(BaseModel):
  """Policy1 model"""


class Policy1Response(APIResponse):
  """Response model for Policy1"""

  data: Optional[Policy1] = None


class Policy1ListResponse(APIResponse):
  """List response model for Policy1"""

  data: List[Policy1] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
