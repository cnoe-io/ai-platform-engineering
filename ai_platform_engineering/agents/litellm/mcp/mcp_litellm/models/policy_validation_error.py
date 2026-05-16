"""Model for Policyvalidationerror"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyvalidationerror(BaseModel):
  """Represents a validation error or warning for a policy."""


class PolicyvalidationerrorResponse(APIResponse):
  """Response model for Policyvalidationerror"""

  data: Optional[Policyvalidationerror] = None


class PolicyvalidationerrorListResponse(APIResponse):
  """List response model for Policyvalidationerror"""

  data: List[Policyvalidationerror] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
