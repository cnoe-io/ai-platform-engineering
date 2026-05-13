"""Model for Cloudzeroinitresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cloudzeroinitresponse(BaseModel):
  """Response model for CloudZero initialization"""


class CloudzeroinitresponseResponse(APIResponse):
  """Response model for Cloudzeroinitresponse"""

  data: Optional[Cloudzeroinitresponse] = None


class CloudzeroinitresponseListResponse(APIResponse):
  """List response model for Cloudzeroinitresponse"""

  data: List[Cloudzeroinitresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
