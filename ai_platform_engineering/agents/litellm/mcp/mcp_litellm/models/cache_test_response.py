"""Model for Cachetestresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cachetestresponse(BaseModel):
  """Cachetestresponse model"""


class CachetestresponseResponse(APIResponse):
  """Response model for Cachetestresponse"""

  data: Optional[Cachetestresponse] = None


class CachetestresponseListResponse(APIResponse):
  """List response model for Cachetestresponse"""

  data: List[Cachetestresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
