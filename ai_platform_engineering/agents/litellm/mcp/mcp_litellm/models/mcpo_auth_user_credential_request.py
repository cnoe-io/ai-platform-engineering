"""Model for Mcpoauthusercredentialrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpoauthusercredentialrequest(BaseModel):
  """Stores a user's OAuth2 token for an OpenAPI MCP server."""


class McpoauthusercredentialrequestResponse(APIResponse):
  """Response model for Mcpoauthusercredentialrequest"""

  data: Optional[Mcpoauthusercredentialrequest] = None


class McpoauthusercredentialrequestListResponse(APIResponse):
  """List response model for Mcpoauthusercredentialrequest"""

  data: List[Mcpoauthusercredentialrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
