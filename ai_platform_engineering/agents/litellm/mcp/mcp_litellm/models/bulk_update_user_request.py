"""Model for Bulkupdateuserrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdateuserrequest(BaseModel):
  """Request for bulk user updates"""


class BulkupdateuserrequestResponse(APIResponse):
  """Response model for Bulkupdateuserrequest"""

  data: Optional[Bulkupdateuserrequest] = None


class BulkupdateuserrequestListResponse(APIResponse):
  """List response model for Bulkupdateuserrequest"""

  data: List[Bulkupdateuserrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
