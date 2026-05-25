"""Model for Oauthflows"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Oauthflows(BaseModel):
  """Defines the configuration for the supported OAuth 2.0 flows."""


class OauthflowsResponse(APIResponse):
  """Response model for Oauthflows"""

  data: Optional[Oauthflows] = None


class OauthflowsListResponse(APIResponse):
  """List response model for Oauthflows"""

  data: List[Oauthflows] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
