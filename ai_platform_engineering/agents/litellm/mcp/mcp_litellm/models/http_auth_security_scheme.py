"""Model for Httpauthsecurityscheme"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Httpauthsecurityscheme(BaseModel):
  """Defines a security scheme using HTTP authentication."""


class HttpauthsecurityschemeResponse(APIResponse):
  """Response model for Httpauthsecurityscheme"""

  data: Optional[Httpauthsecurityscheme] = None


class HttpauthsecurityschemeListResponse(APIResponse):
  """List response model for Httpauthsecurityscheme"""

  data: List[Httpauthsecurityscheme] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
