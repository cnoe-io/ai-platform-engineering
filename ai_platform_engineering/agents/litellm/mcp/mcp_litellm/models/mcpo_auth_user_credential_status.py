"""Model for Mcpoauthusercredentialstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpoauthusercredentialstatus(BaseModel):
  """Describes whether the calling user has a stored OAuth credential."""


class McpoauthusercredentialstatusResponse(APIResponse):
  """Response model for Mcpoauthusercredentialstatus"""

  data: Optional[Mcpoauthusercredentialstatus] = None


class McpoauthusercredentialstatusListResponse(APIResponse):
  """List response model for Mcpoauthusercredentialstatus"""

  data: List[Mcpoauthusercredentialstatus] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
