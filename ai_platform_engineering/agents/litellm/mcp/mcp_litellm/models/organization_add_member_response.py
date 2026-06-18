"""Model for Organizationaddmemberresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Organizationaddmemberresponse(BaseModel):
  """Organizationaddmemberresponse model"""


class OrganizationaddmemberresponseResponse(APIResponse):
  """Response model for Organizationaddmemberresponse"""

  data: Optional[Organizationaddmemberresponse] = None


class OrganizationaddmemberresponseListResponse(APIResponse):
  """List response model for Organizationaddmemberresponse"""

  data: List[Organizationaddmemberresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
