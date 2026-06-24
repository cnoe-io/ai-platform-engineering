"""Model for Policysummaryitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policysummaryitem(BaseModel):
  """Summary of a single policy for list endpoint."""


class PolicysummaryitemResponse(APIResponse):
  """Response model for Policysummaryitem"""

  data: Optional[Policysummaryitem] = None


class PolicysummaryitemListResponse(APIResponse):
  """List response model for Policysummaryitem"""

  data: List[Policysummaryitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
