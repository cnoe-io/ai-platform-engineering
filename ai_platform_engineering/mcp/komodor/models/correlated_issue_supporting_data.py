"""Model for Correlatedissuesupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Correlatedissuesupportingdata(BaseModel):
  """Correlatedissuesupportingdata model"""


class CorrelatedissuesupportingdataResponse(APIResponse):
  """Response model for Correlatedissuesupportingdata"""

  data: Optional[Correlatedissuesupportingdata] = None


class CorrelatedissuesupportingdataListResponse(APIResponse):
  """List response model for Correlatedissuesupportingdata"""

  data: List[Correlatedissuesupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
