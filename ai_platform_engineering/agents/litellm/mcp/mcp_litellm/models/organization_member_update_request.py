"""Model for Organizationmemberupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Organizationmemberupdaterequest(BaseModel):
  """Organizationmemberupdaterequest model"""


class OrganizationmemberupdaterequestResponse(APIResponse):
  """Response model for Organizationmemberupdaterequest"""

  data: Optional[Organizationmemberupdaterequest] = None


class OrganizationmemberupdaterequestListResponse(APIResponse):
  """List response model for Organizationmemberupdaterequest"""

  data: List[Organizationmemberupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
