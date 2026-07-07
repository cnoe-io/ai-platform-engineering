"""Model for Organizationmemberdeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Organizationmemberdeleterequest(BaseModel):
  """Organizationmemberdeleterequest model"""


class OrganizationmemberdeleterequestResponse(APIResponse):
  """Response model for Organizationmemberdeleterequest"""

  data: Optional[Organizationmemberdeleterequest] = None


class OrganizationmemberdeleterequestListResponse(APIResponse):
  """List response model for Organizationmemberdeleterequest"""

  data: List[Organizationmemberdeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
