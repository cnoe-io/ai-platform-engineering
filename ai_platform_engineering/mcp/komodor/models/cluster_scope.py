"""Model for Clusterscope"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Clusterscope(BaseModel):
  """Clusterscope model"""


class ClusterscopeResponse(APIResponse):
  """Response model for Clusterscope"""

  data: Optional[Clusterscope] = None


class ClusterscopeListResponse(APIResponse):
  """List response model for Clusterscope"""

  data: List[Clusterscope] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
