"""Model for Newuserrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newuserrequest(BaseModel):
  """Newuserrequest model"""


class NewuserrequestResponse(APIResponse):
  """Response model for Newuserrequest"""

  data: Optional[Newuserrequest] = None


class NewuserrequestListResponse(APIResponse):
  """List response model for Newuserrequest"""

  data: List[Newuserrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
