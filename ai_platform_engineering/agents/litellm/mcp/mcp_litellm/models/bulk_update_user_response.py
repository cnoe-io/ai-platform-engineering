"""Model for Bulkupdateuserresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdateuserresponse(BaseModel):
  """Response for bulk user update operations"""


class BulkupdateuserresponseResponse(APIResponse):
  """Response model for Bulkupdateuserresponse"""

  data: Optional[Bulkupdateuserresponse] = None


class BulkupdateuserresponseListResponse(APIResponse):
  """List response model for Bulkupdateuserresponse"""

  data: List[Bulkupdateuserresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
