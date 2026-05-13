"""Model for Costestimateresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costestimateresponse(BaseModel):
  """Response body for /cost/estimate endpoint."""


class CostestimateresponseResponse(APIResponse):
  """Response model for Costestimateresponse"""

  data: Optional[Costestimateresponse] = None


class CostestimateresponseListResponse(APIResponse):
  """List response model for Costestimateresponse"""

  data: List[Costestimateresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
