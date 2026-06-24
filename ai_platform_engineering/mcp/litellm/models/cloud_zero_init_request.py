"""Model for Cloudzeroinitrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cloudzeroinitrequest(BaseModel):
  """Request model for initializing CloudZero settings"""


class CloudzeroinitrequestResponse(APIResponse):
  """Response model for Cloudzeroinitrequest"""

  data: Optional[Cloudzeroinitrequest] = None


class CloudzeroinitrequestListResponse(APIResponse):
  """List response model for Cloudzeroinitrequest"""

  data: List[Cloudzeroinitrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
