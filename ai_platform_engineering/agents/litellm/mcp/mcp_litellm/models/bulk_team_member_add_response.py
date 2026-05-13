"""Model for Bulkteammemberaddresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkteammemberaddresponse(BaseModel):
  """Response for bulk team member add operations"""


class BulkteammemberaddresponseResponse(APIResponse):
  """Response model for Bulkteammemberaddresponse"""

  data: Optional[Bulkteammemberaddresponse] = None


class BulkteammemberaddresponseListResponse(APIResponse):
  """List response model for Bulkteammemberaddresponse"""

  data: List[Bulkteammemberaddresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
