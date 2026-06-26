"""Model for Neworganizationrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Neworganizationrequest(BaseModel):
  """Neworganizationrequest model"""


class NeworganizationrequestResponse(APIResponse):
  """Response model for Neworganizationrequest"""

  data: Optional[Neworganizationrequest] = None


class NeworganizationrequestListResponse(APIResponse):
  """List response model for Neworganizationrequest"""

  data: List[Neworganizationrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
