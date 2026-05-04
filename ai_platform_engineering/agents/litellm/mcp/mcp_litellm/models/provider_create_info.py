"""Model for Providercreateinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Providercreateinfo(BaseModel):
  """Providercreateinfo model"""


class ProvidercreateinfoResponse(APIResponse):
  """Response model for Providercreateinfo"""

  data: Optional[Providercreateinfo] = None


class ProvidercreateinfoListResponse(APIResponse):
  """List response model for Providercreateinfo"""

  data: List[Providercreateinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
