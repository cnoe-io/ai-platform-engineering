"""Model for Routerfieldsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Routerfieldsresponse(BaseModel):
  """Routerfieldsresponse model"""


class RouterfieldsresponseResponse(APIResponse):
  """Response model for Routerfieldsresponse"""

  data: Optional[Routerfieldsresponse] = None


class RouterfieldsresponseListResponse(APIResponse):
  """List response model for Routerfieldsresponse"""

  data: List[Routerfieldsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
