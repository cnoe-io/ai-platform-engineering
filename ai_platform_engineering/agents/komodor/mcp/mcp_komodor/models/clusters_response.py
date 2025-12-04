"""Model for Clustersresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Clustersresponse(BaseModel):
  """Clustersresponse model"""


class ClustersresponseResponse(APIResponse):
  """Response model for Clustersresponse"""

  data: Optional[Clustersresponse] = None


class ClustersresponseListResponse(APIResponse):
  """List response model for Clustersresponse"""

  data: List[Clustersresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
