"""Model for Paginationtokenparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Paginationtokenparams(BaseModel):
  """Paginationtokenparams model"""


class PaginationtokenparamsResponse(APIResponse):
  """Response model for Paginationtokenparams"""

  data: Optional[Paginationtokenparams] = None


class PaginationtokenparamsListResponse(APIResponse):
  """List response model for Paginationtokenparams"""

  data: List[Paginationtokenparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
