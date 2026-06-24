"""Model for K8seventtype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class K8seventtype(BaseModel):
  """The type of the event"""


class K8seventtypeResponse(APIResponse):
  """Response model for K8seventtype"""

  data: Optional[K8seventtype] = None


class K8seventtypeListResponse(APIResponse):
  """List response model for K8seventtype"""

  data: List[K8seventtype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
