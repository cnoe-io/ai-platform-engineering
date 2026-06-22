"""Model for Newcustomerrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newcustomerrequest(BaseModel):
  """Create a new customer, allocate a budget to them"""


class NewcustomerrequestResponse(APIResponse):
  """Response model for Newcustomerrequest"""

  data: Optional[Newcustomerrequest] = None


class NewcustomerrequestListResponse(APIResponse):
  """List response model for Newcustomerrequest"""

  data: List[Newcustomerrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
