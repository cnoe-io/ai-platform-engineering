"""Model for Cachesettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cachesettingsresponse(BaseModel):
  """Cachesettingsresponse model"""


class CachesettingsresponseResponse(APIResponse):
  """Response model for Cachesettingsresponse"""

  data: Optional[Cachesettingsresponse] = None


class CachesettingsresponseListResponse(APIResponse):
  """List response model for Cachesettingsresponse"""

  data: List[Cachesettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
