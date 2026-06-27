"""Model for Indexcreatelitellmparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Indexcreatelitellmparams(BaseModel):
  """Indexcreatelitellmparams model"""


class IndexcreatelitellmparamsResponse(APIResponse):
  """Response model for Indexcreatelitellmparams"""

  data: Optional[Indexcreatelitellmparams] = None


class IndexcreatelitellmparamsListResponse(APIResponse):
  """List response model for Indexcreatelitellmparams"""

  data: List[Indexcreatelitellmparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
