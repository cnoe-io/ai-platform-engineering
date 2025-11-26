"""Model for Userroleupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userroleupdaterequest(BaseModel):
  """Userroleupdaterequest model"""


class UserroleupdaterequestResponse(APIResponse):
  """Response model for Userroleupdaterequest"""

  data: Optional[Userroleupdaterequest] = None


class UserroleupdaterequestListResponse(APIResponse):
  """List response model for Userroleupdaterequest"""

  data: List[Userroleupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
