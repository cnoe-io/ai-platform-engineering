"""Model for Cachetestrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cachetestrequest(BaseModel):
  """Cachetestrequest model"""


class CachetestrequestResponse(APIResponse):
  """Response model for Cachetestrequest"""

  data: Optional[Cachetestrequest] = None


class CachetestrequestListResponse(APIResponse):
  """List response model for Cachetestrequest"""

  data: List[Cachetestrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
