"""Model for Newuserresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newuserresponse(BaseModel):
  """Newuserresponse model"""


class NewuserresponseResponse(APIResponse):
  """Response model for Newuserresponse"""

  data: Optional[Newuserresponse] = None


class NewuserresponseListResponse(APIResponse):
  """List response model for Newuserresponse"""

  data: List[Newuserresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
