"""Model for Userlistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userlistresponse(BaseModel):
  """Response model for the user list endpoint"""


class UserlistresponseResponse(APIResponse):
  """Response model for Userlistresponse"""

  data: Optional[Userlistresponse] = None


class UserlistresponseListResponse(APIResponse):
  """List response model for Userlistresponse"""

  data: List[Userlistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
