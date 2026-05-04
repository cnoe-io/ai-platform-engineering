"""Model for Updateprojectrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateprojectrequest(BaseModel):
  """Request model for POST /project/update"""


class UpdateprojectrequestResponse(APIResponse):
  """Response model for Updateprojectrequest"""

  data: Optional[Updateprojectrequest] = None


class UpdateprojectrequestListResponse(APIResponse):
  """List response model for Updateprojectrequest"""

  data: List[Updateprojectrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
