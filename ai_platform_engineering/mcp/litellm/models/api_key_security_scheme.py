"""Model for Apikeysecurityscheme"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Apikeysecurityscheme(BaseModel):
  """Defines a security scheme using an API key."""


class ApikeysecurityschemeResponse(APIResponse):
  """Response model for Apikeysecurityscheme"""

  data: Optional[Apikeysecurityscheme] = None


class ApikeysecurityschemeListResponse(APIResponse):
  """List response model for Apikeysecurityscheme"""

  data: List[Apikeysecurityscheme] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
