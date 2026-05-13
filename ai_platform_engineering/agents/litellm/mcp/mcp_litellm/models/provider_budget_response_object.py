"""Model for Providerbudgetresponseobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Providerbudgetresponseobject(BaseModel):
  """Configuration for a single provider's budget settings"""


class ProviderbudgetresponseobjectResponse(APIResponse):
  """Response model for Providerbudgetresponseobject"""

  data: Optional[Providerbudgetresponseobject] = None


class ProviderbudgetresponseobjectListResponse(APIResponse):
  """List response model for Providerbudgetresponseobject"""

  data: List[Providerbudgetresponseobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
