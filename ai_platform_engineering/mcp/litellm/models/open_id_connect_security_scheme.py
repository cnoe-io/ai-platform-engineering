"""Model for Openidconnectsecurityscheme"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Openidconnectsecurityscheme(BaseModel):
  """Defines a security scheme using OpenID Connect."""


class OpenidconnectsecurityschemeResponse(APIResponse):
  """Response model for Openidconnectsecurityscheme"""

  data: Optional[Openidconnectsecurityscheme] = None


class OpenidconnectsecurityschemeListResponse(APIResponse):
  """List response model for Openidconnectsecurityscheme"""

  data: List[Openidconnectsecurityscheme] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
