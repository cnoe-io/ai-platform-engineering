"""Model for LitellmOrganizationtablewithmembers"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmOrganizationtablewithmembers(BaseModel):
  """Returned by the /organization/info endpoint and /organization/list endpoint"""


class LitellmOrganizationtablewithmembersResponse(APIResponse):
  """Response model for LitellmOrganizationtablewithmembers"""

  data: Optional[LitellmOrganizationtablewithmembers] = None


class LitellmOrganizationtablewithmembersListResponse(APIResponse):
  """List response model for LitellmOrganizationtablewithmembers"""

  data: List[LitellmOrganizationtablewithmembers] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
