"""Model for Policyresolverequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyresolverequest(BaseModel):
  """Request body for resolving effective policies/guardrails for a context."""


class PolicyresolverequestResponse(APIResponse):
  """Response model for Policyresolverequest"""

  data: Optional[Policyresolverequest] = None


class PolicyresolverequestListResponse(APIResponse):
  """List response model for Policyresolverequest"""

  data: List[Policyresolverequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
