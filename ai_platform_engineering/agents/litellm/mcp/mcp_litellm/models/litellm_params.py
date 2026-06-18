"""Model for Litellmparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Litellmparams(BaseModel):
  """Litellmparams model"""


class LitellmparamsResponse(APIResponse):
  """Response model for Litellmparams"""

  data: Optional[Litellmparams] = None


class LitellmparamsListResponse(APIResponse):
  """List response model for Litellmparams"""

  data: List[Litellmparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
