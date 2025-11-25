"""Model for Getmonitorsdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getmonitorsdata(BaseModel):
  """Getmonitorsdata model"""


class GetmonitorsdataResponse(APIResponse):
  """Response model for Getmonitorsdata"""

  data: Optional[Getmonitorsdata] = None


class GetmonitorsdataListResponse(APIResponse):
  """List response model for Getmonitorsdata"""

  data: List[Getmonitorsdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
