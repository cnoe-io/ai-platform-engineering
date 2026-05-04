"""Model for Orgmember"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Orgmember(BaseModel):
  """Orgmember model"""


class OrgmemberResponse(APIResponse):
  """Response model for Orgmember"""

  data: Optional[Orgmember] = None


class OrgmemberListResponse(APIResponse):
  """List response model for Orgmember"""

  data: List[Orgmember] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
