"""Model for Member"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Member(BaseModel):
  """Member model"""


class MemberResponse(APIResponse):
  """Response model for Member"""

  data: Optional[Member] = None


class MemberListResponse(APIResponse):
  """List response model for Member"""

  data: List[Member] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
