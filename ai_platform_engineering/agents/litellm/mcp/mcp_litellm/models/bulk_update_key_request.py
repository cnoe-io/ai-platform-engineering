"""Model for Bulkupdatekeyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdatekeyrequest(BaseModel):
  """Request for bulk key updates"""


class BulkupdatekeyrequestResponse(APIResponse):
  """Response model for Bulkupdatekeyrequest"""

  data: Optional[Bulkupdatekeyrequest] = None


class BulkupdatekeyrequestListResponse(APIResponse):
  """List response model for Bulkupdatekeyrequest"""

  data: List[Bulkupdatekeyrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
