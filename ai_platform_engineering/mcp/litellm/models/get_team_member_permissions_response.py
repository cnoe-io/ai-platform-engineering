"""Model for Getteammemberpermissionsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getteammemberpermissionsresponse(BaseModel):
  """Response to get the team member permissions for a team"""


class GetteammemberpermissionsresponseResponse(APIResponse):
  """Response model for Getteammemberpermissionsresponse"""

  data: Optional[Getteammemberpermissionsresponse] = None


class GetteammemberpermissionsresponseListResponse(APIResponse):
  """List response model for Getteammemberpermissionsresponse"""

  data: List[Getteammemberpermissionsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
