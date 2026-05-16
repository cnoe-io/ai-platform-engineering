"""Model for Policyvalidationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyvalidationresponse(BaseModel):
  """Response from policy validation.

  - `valid`: True if no blocking errors were found
  - `errors`: List of blocking errors (prevent policy from being applied)
  - `warnings`: List of non-blocking warnings (policy can still be applied)"""


class PolicyvalidationresponseResponse(APIResponse):
  """Response model for Policyvalidationresponse"""

  data: Optional[Policyvalidationresponse] = None


class PolicyvalidationresponseListResponse(APIResponse):
  """List response model for Policyvalidationresponse"""

  data: List[Policyvalidationresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
