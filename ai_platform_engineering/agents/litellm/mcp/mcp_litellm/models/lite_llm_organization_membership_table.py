"""Model for LitellmOrganizationmembershiptable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmOrganizationmembershiptable(BaseModel):
  """This is the table that track what organizations a user belongs to and users spend within the organization"""


class LitellmOrganizationmembershiptableResponse(APIResponse):
  """Response model for LitellmOrganizationmembershiptable"""

  data: Optional[LitellmOrganizationmembershiptable] = None


class LitellmOrganizationmembershiptableListResponse(APIResponse):
  """List response model for LitellmOrganizationmembershiptable"""

  data: List[LitellmOrganizationmembershiptable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
