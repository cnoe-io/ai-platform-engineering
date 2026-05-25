"""Model for Configoverridesettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Configoverridesettingsresponse(BaseModel):
  """Response model for config override settings GET endpoints."""


class ConfigoverridesettingsresponseResponse(APIResponse):
  """Response model for Configoverridesettingsresponse"""

  data: Optional[Configoverridesettingsresponse] = None


class ConfigoverridesettingsresponseListResponse(APIResponse):
  """List response model for Configoverridesettingsresponse"""

  data: List[Configoverridesettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
