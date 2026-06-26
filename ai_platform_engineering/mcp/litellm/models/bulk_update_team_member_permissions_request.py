"""Model for Bulkupdateteammemberpermissionsrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdateteammemberpermissionsrequest(BaseModel):
  """Request to bulk-update team member permissions across teams."""


class BulkupdateteammemberpermissionsrequestResponse(APIResponse):
  """Response model for Bulkupdateteammemberpermissionsrequest"""

  data: Optional[Bulkupdateteammemberpermissionsrequest] = None


class BulkupdateteammemberpermissionsrequestListResponse(APIResponse):
  """List response model for Bulkupdateteammemberpermissionsrequest"""

  data: List[Bulkupdateteammemberpermissionsrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
