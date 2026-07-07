"""Model for Resource"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Resource(BaseModel):
  """Resource model"""


class ResourceResponse(APIResponse):
  """Response model for Resource"""

  data: Optional[Resource] = None


class ResourceListResponse(APIResponse):
  """List response model for Resource"""

  data: List[Resource] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
