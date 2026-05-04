"""Model for Cloudzeroexportrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cloudzeroexportrequest(BaseModel):
  """Request model for CloudZero export operations"""


class CloudzeroexportrequestResponse(APIResponse):
  """Response model for Cloudzeroexportrequest"""

  data: Optional[Cloudzeroexportrequest] = None


class CloudzeroexportrequestListResponse(APIResponse):
  """List response model for Cloudzeroexportrequest"""

  data: List[Cloudzeroexportrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
