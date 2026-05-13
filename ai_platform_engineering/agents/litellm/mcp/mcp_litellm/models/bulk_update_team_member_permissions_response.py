"""Model for Bulkupdateteammemberpermissionsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdateteammemberpermissionsresponse(BaseModel):
  """Response for bulk team member permissions update."""


class BulkupdateteammemberpermissionsresponseResponse(APIResponse):
  """Response model for Bulkupdateteammemberpermissionsresponse"""

  data: Optional[Bulkupdateteammemberpermissionsresponse] = None


class BulkupdateteammemberpermissionsresponseListResponse(APIResponse):
  """List response model for Bulkupdateteammemberpermissionsresponse"""

  data: List[Bulkupdateteammemberpermissionsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
