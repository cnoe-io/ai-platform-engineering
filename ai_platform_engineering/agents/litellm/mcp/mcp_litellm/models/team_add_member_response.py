"""Model for Teamaddmemberresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teamaddmemberresponse(BaseModel):
  """Teamaddmemberresponse model"""


class TeamaddmemberresponseResponse(APIResponse):
  """Response model for Teamaddmemberresponse"""

  data: Optional[Teamaddmemberresponse] = None


class TeamaddmemberresponseListResponse(APIResponse):
  """List response model for Teamaddmemberresponse"""

  data: List[Teamaddmemberresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
