"""Model for Deleteprojectrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteprojectrequest(BaseModel):
  """Request model for DELETE /project/delete"""


class DeleteprojectrequestResponse(APIResponse):
  """Response model for Deleteprojectrequest"""

  data: Optional[Deleteprojectrequest] = None


class DeleteprojectrequestListResponse(APIResponse):
  """List response model for Deleteprojectrequest"""

  data: List[Deleteprojectrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
