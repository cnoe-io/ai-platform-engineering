"""Model for Clusterprovidertype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Clusterprovidertype(BaseModel):
  """Clusterprovidertype model"""


class ClusterprovidertypeResponse(APIResponse):
  """Response model for Clusterprovidertype"""

  data: Optional[Clusterprovidertype] = None


class ClusterprovidertypeListResponse(APIResponse):
  """List response model for Clusterprovidertype"""

  data: List[Clusterprovidertype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
