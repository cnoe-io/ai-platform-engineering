"""Model for Litellmuserroles"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Litellmuserroles(BaseModel):
  """Admin Roles:
  PROXY_ADMIN: admin over the platform
  PROXY_ADMIN_VIEW_ONLY: can login, view all own keys, view all spend
  ORG_ADMIN: admin over a specific organization, can create teams, users only within their organization

  Internal User Roles:
  INTERNAL_USER: can login, view/create/delete their own keys, view their spend
  INTERNAL_USER_VIEW_ONLY: can login, view their own keys, view their own spend


  Team Roles:
  TEAM: used for JWT auth


  Customer Roles:
  CUSTOMER: External users -> these are customers"""


class LitellmuserrolesResponse(APIResponse):
  """Response model for Litellmuserroles"""

  data: Optional[Litellmuserroles] = None


class LitellmuserrolesListResponse(APIResponse):
  """List response model for Litellmuserroles"""

  data: List[Litellmuserroles] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
