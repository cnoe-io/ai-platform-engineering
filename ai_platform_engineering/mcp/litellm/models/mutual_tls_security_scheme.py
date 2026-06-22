"""Model for Mutualtlssecurityscheme"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mutualtlssecurityscheme(BaseModel):
  """Defines a security scheme using mTLS authentication."""


class MutualtlssecurityschemeResponse(APIResponse):
  """Response model for Mutualtlssecurityscheme"""

  data: Optional[Mutualtlssecurityscheme] = None


class MutualtlssecurityschemeListResponse(APIResponse):
  """List response model for Mutualtlssecurityscheme"""

  data: List[Mutualtlssecurityscheme] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
