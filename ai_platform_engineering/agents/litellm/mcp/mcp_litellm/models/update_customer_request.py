"""Model for Updatecustomerrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatecustomerrequest(BaseModel):
  """Update a Customer, use this to update customer budgets etc"""


class UpdatecustomerrequestResponse(APIResponse):
  """Response model for Updatecustomerrequest"""

  data: Optional[Updatecustomerrequest] = None


class UpdatecustomerrequestListResponse(APIResponse):
  """List response model for Updatecustomerrequest"""

  data: List[Updatecustomerrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
