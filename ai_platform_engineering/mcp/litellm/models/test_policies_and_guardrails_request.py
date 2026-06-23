"""Model for Testpoliciesandguardrailsrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testpoliciesandguardrailsrequest(BaseModel):
  """Request body for POST /utils/test_policies_and_guardrails."""


class TestpoliciesandguardrailsrequestResponse(APIResponse):
  """Response model for Testpoliciesandguardrailsrequest"""

  data: Optional[Testpoliciesandguardrailsrequest] = None


class TestpoliciesandguardrailsrequestListResponse(APIResponse):
  """List response model for Testpoliciesandguardrailsrequest"""

  data: List[Testpoliciesandguardrailsrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
