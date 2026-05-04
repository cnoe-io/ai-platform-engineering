"""Model for Organizationmemberaddrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Organizationmemberaddrequest(BaseModel):
  """Organizationmemberaddrequest model"""


class OrganizationmemberaddrequestResponse(APIResponse):
  """Response model for Organizationmemberaddrequest"""

  data: Optional[Organizationmemberaddrequest] = None


class OrganizationmemberaddrequestListResponse(APIResponse):
  """List response model for Organizationmemberaddrequest"""

  data: List[Organizationmemberaddrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
