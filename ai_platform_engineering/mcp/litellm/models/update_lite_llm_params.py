"""Model for Updatelitellmparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatelitellmparams(BaseModel):
  """Updatelitellmparams model"""


class UpdatelitellmparamsResponse(APIResponse):
  """Response model for Updatelitellmparams"""

  data: Optional[Updatelitellmparams] = None


class UpdatelitellmparamsListResponse(APIResponse):
  """List response model for Updatelitellmparams"""

  data: List[Updatelitellmparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
