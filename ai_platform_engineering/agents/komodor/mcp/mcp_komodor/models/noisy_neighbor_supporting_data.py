"""Model for Noisyneighborsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Noisyneighborsupportingdata(BaseModel):
  """Noisyneighborsupportingdata model"""


class NoisyneighborsupportingdataResponse(APIResponse):
  """Response model for Noisyneighborsupportingdata"""

  data: Optional[Noisyneighborsupportingdata] = None


class NoisyneighborsupportingdataListResponse(APIResponse):
  """List response model for Noisyneighborsupportingdata"""

  data: List[Noisyneighborsupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
