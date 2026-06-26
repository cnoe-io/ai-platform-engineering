"""Model for Newprojectrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newprojectrequest(BaseModel):
  """Request model for POST /project/new"""


class NewprojectrequestResponse(APIResponse):
  """Response model for Newprojectrequest"""

  data: Optional[Newprojectrequest] = None


class NewprojectrequestListResponse(APIResponse):
  """List response model for Newprojectrequest"""

  data: List[Newprojectrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
