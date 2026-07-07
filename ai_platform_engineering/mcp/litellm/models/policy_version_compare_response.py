"""Model for Policyversioncompareresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyversioncompareresponse(BaseModel):
  """Response for comparing two policy versions."""


class PolicyversioncompareresponseResponse(APIResponse):
  """Response model for Policyversioncompareresponse"""

  data: Optional[Policyversioncompareresponse] = None


class PolicyversioncompareresponseListResponse(APIResponse):
  """List response model for Policyversioncompareresponse"""

  data: List[Policyversioncompareresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
