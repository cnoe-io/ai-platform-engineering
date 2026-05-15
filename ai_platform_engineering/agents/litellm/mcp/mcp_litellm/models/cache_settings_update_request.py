"""Model for Cachesettingsupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cachesettingsupdaterequest(BaseModel):
  """Cachesettingsupdaterequest model"""


class CachesettingsupdaterequestResponse(APIResponse):
  """Response model for Cachesettingsupdaterequest"""

  data: Optional[Cachesettingsupdaterequest] = None


class CachesettingsupdaterequestListResponse(APIResponse):
  """List response model for Cachesettingsupdaterequest"""

  data: List[Cachesettingsupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
