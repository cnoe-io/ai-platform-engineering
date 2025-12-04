"""Model for Singlecluster"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singlecluster(BaseModel):
  """Singlecluster model"""


class SingleclusterResponse(APIResponse):
  """Response model for Singlecluster"""

  data: Optional[Singlecluster] = None


class SingleclusterListResponse(APIResponse):
  """List response model for Singlecluster"""

  data: List[Singlecluster] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
