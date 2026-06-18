"""Model for Vantageinitrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantageinitrequest(BaseModel):
  """Request model for initializing Vantage settings"""


class VantageinitrequestResponse(APIResponse):
  """Response model for Vantageinitrequest"""

  data: Optional[Vantageinitrequest] = None


class VantageinitrequestListResponse(APIResponse):
  """List response model for Vantageinitrequest"""

  data: List[Vantageinitrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
