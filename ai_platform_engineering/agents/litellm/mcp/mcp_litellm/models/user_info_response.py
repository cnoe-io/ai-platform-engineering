"""Model for Userinforesponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userinforesponse(BaseModel):
  """Userinforesponse model"""


class UserinforesponseResponse(APIResponse):
  """Response model for Userinforesponse"""

  data: Optional[Userinforesponse] = None


class UserinforesponseListResponse(APIResponse):
  """List response model for Userinforesponse"""

  data: List[Userinforesponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
