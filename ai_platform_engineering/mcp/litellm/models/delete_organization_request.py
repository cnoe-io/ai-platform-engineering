"""Model for Deleteorganizationrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteorganizationrequest(BaseModel):
  """Deleteorganizationrequest model"""


class DeleteorganizationrequestResponse(APIResponse):
  """Response model for Deleteorganizationrequest"""

  data: Optional[Deleteorganizationrequest] = None


class DeleteorganizationrequestListResponse(APIResponse):
  """List response model for Deleteorganizationrequest"""

  data: List[Deleteorganizationrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
