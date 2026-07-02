"""Model for Unschedulablepodsimpactdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Unschedulablepodsimpactdata(BaseModel):
  """Unschedulablepodsimpactdata model"""


class UnschedulablepodsimpactdataResponse(APIResponse):
  """Response model for Unschedulablepodsimpactdata"""

  data: Optional[Unschedulablepodsimpactdata] = None


class UnschedulablepodsimpactdataListResponse(APIResponse):
  """List response model for Unschedulablepodsimpactdata"""

  data: List[Unschedulablepodsimpactdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
