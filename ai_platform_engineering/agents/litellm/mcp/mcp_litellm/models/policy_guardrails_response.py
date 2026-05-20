"""Model for Policyguardrailsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyguardrailsresponse(BaseModel):
  """Guardrails configuration for a policy."""


class PolicyguardrailsresponseResponse(APIResponse):
  """Response model for Policyguardrailsresponse"""

  data: Optional[Policyguardrailsresponse] = None


class PolicyguardrailsresponseListResponse(APIResponse):
  """List response model for Policyguardrailsresponse"""

  data: List[Policyguardrailsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
