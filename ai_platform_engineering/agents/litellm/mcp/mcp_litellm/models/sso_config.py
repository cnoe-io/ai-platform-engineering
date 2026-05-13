"""Model for Ssoconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Ssoconfig(BaseModel):
  """Configuration for SSO environment variables and settings"""


class SsoconfigResponse(APIResponse):
  """Response model for Ssoconfig"""

  data: Optional[Ssoconfig] = None


class SsoconfigListResponse(APIResponse):
  """List response model for Ssoconfig"""

  data: List[Ssoconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
