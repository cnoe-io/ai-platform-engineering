"""Model for Nodeterminationsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Nodeterminationsupportingdata(BaseModel):
  """Nodeterminationsupportingdata model"""


class NodeterminationsupportingdataResponse(APIResponse):
  """Response model for Nodeterminationsupportingdata"""

  data: Optional[Nodeterminationsupportingdata] = None


class NodeterminationsupportingdataListResponse(APIResponse):
  """List response model for Nodeterminationsupportingdata"""

  data: List[Nodeterminationsupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
