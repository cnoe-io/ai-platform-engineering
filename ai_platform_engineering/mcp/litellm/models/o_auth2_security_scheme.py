"""Model for Oauth2securityscheme"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Oauth2securityscheme(BaseModel):
  """Defines a security scheme using OAuth 2.0."""


class Oauth2securityschemeResponse(APIResponse):
  """Response model for Oauth2securityscheme"""

  data: Optional[Oauth2securityscheme] = None


class Oauth2securityschemeListResponse(APIResponse):
  """List response model for Oauth2securityscheme"""

  data: List[Oauth2securityscheme] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
