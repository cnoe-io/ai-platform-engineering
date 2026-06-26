"""Model for Uidiscoveryendpoints"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Uidiscoveryendpoints(BaseModel):
  """Uidiscoveryendpoints model"""


class UidiscoveryendpointsResponse(APIResponse):
  """Response model for Uidiscoveryendpoints"""

  data: Optional[Uidiscoveryendpoints] = None


class UidiscoveryendpointsListResponse(APIResponse):
  """List response model for Uidiscoveryendpoints"""

  data: List[Uidiscoveryendpoints] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
