"""Model for Organizationrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Organizationrequest(BaseModel):
  """Organizationrequest model"""


class OrganizationrequestResponse(APIResponse):
  """Response model for Organizationrequest"""

  data: Optional[Organizationrequest] = None


class OrganizationrequestListResponse(APIResponse):
  """List response model for Organizationrequest"""

  data: List[Organizationrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
