"""Model for Monitorconfigurationparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Monitorconfigurationparams(BaseModel):
  """Monitorconfigurationparams model"""


class MonitorconfigurationparamsResponse(APIResponse):
  """Response model for Monitorconfigurationparams"""

  data: Optional[Monitorconfigurationparams] = None


class MonitorconfigurationparamsListResponse(APIResponse):
  """List response model for Monitorconfigurationparams"""

  data: List[Monitorconfigurationparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
