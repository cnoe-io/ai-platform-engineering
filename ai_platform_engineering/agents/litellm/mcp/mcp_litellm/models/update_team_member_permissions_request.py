"""Model for Updateteammemberpermissionsrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateteammemberpermissionsrequest(BaseModel):
  """Request to update the team member permissions for a team"""


class UpdateteammemberpermissionsrequestResponse(APIResponse):
  """Response model for Updateteammemberpermissionsrequest"""

  data: Optional[Updateteammemberpermissionsrequest] = None


class UpdateteammemberpermissionsrequestListResponse(APIResponse):
  """List response model for Updateteammemberpermissionsrequest"""

  data: List[Updateteammemberpermissionsrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
