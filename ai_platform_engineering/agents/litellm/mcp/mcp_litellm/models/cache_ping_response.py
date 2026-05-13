"""Model for Cachepingresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cachepingresponse(BaseModel):
  """Cachepingresponse model"""


class CachepingresponseResponse(APIResponse):
  """Response model for Cachepingresponse"""

  data: Optional[Cachepingresponse] = None


class CachepingresponseListResponse(APIResponse):
  """List response model for Cachepingresponse"""

  data: List[Cachepingresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
