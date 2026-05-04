"""Model for Bulkteammemberaddrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkteammemberaddrequest(BaseModel):
  """Request for bulk team member addition"""


class BulkteammemberaddrequestResponse(APIResponse):
  """Response model for Bulkteammemberaddrequest"""

  data: Optional[Bulkteammemberaddrequest] = None


class BulkteammemberaddrequestListResponse(APIResponse):
  """List response model for Bulkteammemberaddrequest"""

  data: List[Bulkteammemberaddrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
