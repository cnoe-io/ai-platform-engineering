"""Model for Policyscoperesponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyscoperesponse(BaseModel):
  """Scope configuration for a policy."""


class PolicyscoperesponseResponse(APIResponse):
  """Response model for Policyscoperesponse"""

  data: Optional[Policyscoperesponse] = None


class PolicyscoperesponseListResponse(APIResponse):
  """List response model for Policyscoperesponse"""

  data: List[Policyscoperesponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
