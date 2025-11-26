"""Model for Userrolecreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userrolecreaterequest(BaseModel):
  """Userrolecreaterequest model"""


class UserrolecreaterequestResponse(APIResponse):
  """Response model for Userrolecreaterequest"""

  data: Optional[Userrolecreaterequest] = None


class UserrolecreaterequestListResponse(APIResponse):
  """List response model for Userrolecreaterequest"""

  data: List[Userrolecreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
