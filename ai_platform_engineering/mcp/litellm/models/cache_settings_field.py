"""Model for Cachesettingsfield"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cachesettingsfield(BaseModel):
  """Cachesettingsfield model"""


class CachesettingsfieldResponse(APIResponse):
  """Response model for Cachesettingsfield"""

  data: Optional[Cachesettingsfield] = None


class CachesettingsfieldListResponse(APIResponse):
  """List response model for Cachesettingsfield"""

  data: List[Cachesettingsfield] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
