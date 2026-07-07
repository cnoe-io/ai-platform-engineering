"""Model for Providerbudgetresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Providerbudgetresponse(BaseModel):
  """Complete provider budget configuration and status.
  Maps provider names to their budget configs."""


class ProviderbudgetresponseResponse(APIResponse):
  """Response model for Providerbudgetresponse"""

  data: Optional[Providerbudgetresponse] = None


class ProviderbudgetresponseListResponse(APIResponse):
  """List response model for Providerbudgetresponse"""

  data: List[Providerbudgetresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
