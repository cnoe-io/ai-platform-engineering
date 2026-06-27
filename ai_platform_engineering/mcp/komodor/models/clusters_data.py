"""Model for Clustersdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Clustersdata(BaseModel):
  """Clustersdata model"""


class ClustersdataResponse(APIResponse):
  """Response model for Clustersdata"""

  data: Optional[Clustersdata] = None


class ClustersdataListResponse(APIResponse):
  """List response model for Clustersdata"""

  data: List[Clustersdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
