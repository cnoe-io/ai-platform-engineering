"""Model for Rolemappings"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rolemappings(BaseModel):
  """Configuration for mapping SSO groups to LiteLLM roles.

  The system will look at the group_claim field in the SSO token to determine
  which role to assign the user based on the roles mapping."""


class RolemappingsResponse(APIResponse):
  """Response model for Rolemappings"""

  data: Optional[Rolemappings] = None


class RolemappingsListResponse(APIResponse):
  """List response model for Rolemappings"""

  data: List[Rolemappings] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
