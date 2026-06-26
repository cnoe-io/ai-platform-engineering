"""Model for Teammappings"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammappings(BaseModel):
  """Configuration for mapping SSO JWT fields to team IDs.

  This allows configuring team_ids_jwt_field via the database instead of
  requiring config file changes and restarts."""


class TeammappingsResponse(APIResponse):
  """Response model for Teammappings"""

  data: Optional[Teammappings] = None


class TeammappingsListResponse(APIResponse):
  """List response model for Teammappings"""

  data: List[Teammappings] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
