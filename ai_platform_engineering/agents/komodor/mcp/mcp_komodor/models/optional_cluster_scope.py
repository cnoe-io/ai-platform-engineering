"""Model for Optionalclusterscope"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Optionalclusterscope(BaseModel):
  """Optionalclusterscope model"""


class OptionalclusterscopeResponse(APIResponse):
  """Response model for Optionalclusterscope"""

  data: Optional[Optionalclusterscope] = None


class OptionalclusterscopeListResponse(APIResponse):
  """List response model for Optionalclusterscope"""

  data: List[Optionalclusterscope] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
