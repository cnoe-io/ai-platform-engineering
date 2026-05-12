"""Model for Deletecustomerrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deletecustomerrequest(BaseModel):
  """Delete multiple Customers"""


class DeletecustomerrequestResponse(APIResponse):
  """Response model for Deletecustomerrequest"""

  data: Optional[Deletecustomerrequest] = None


class DeletecustomerrequestListResponse(APIResponse):
  """List response model for Deletecustomerrequest"""

  data: List[Deletecustomerrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
