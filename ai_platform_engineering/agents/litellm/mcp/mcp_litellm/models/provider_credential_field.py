"""Model for Providercredentialfield"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Providercredentialfield(BaseModel):
  """Providercredentialfield model"""


class ProvidercredentialfieldResponse(APIResponse):
  """Response model for Providercredentialfield"""

  data: Optional[Providercredentialfield] = None


class ProvidercredentialfieldListResponse(APIResponse):
  """List response model for Providercredentialfield"""

  data: List[Providercredentialfield] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
