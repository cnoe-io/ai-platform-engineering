"""Model for Costestimaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costestimaterequest(BaseModel):
  """Request body for /cost/estimate endpoint."""


class CostestimaterequestResponse(APIResponse):
  """Response model for Costestimaterequest"""

  data: Optional[Costestimaterequest] = None


class CostestimaterequestListResponse(APIResponse):
  """List response model for Costestimaterequest"""

  data: List[Costestimaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
