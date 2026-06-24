"""Model for Clusterscopewrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Clusterscopewrapper(BaseModel):
  """Clusterscopewrapper model"""


class ClusterscopewrapperResponse(APIResponse):
  """Response model for Clusterscopewrapper"""

  data: Optional[Clusterscopewrapper] = None


class ClusterscopewrapperListResponse(APIResponse):
  """List response model for Clusterscopewrapper"""

  data: List[Clusterscopewrapper] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
