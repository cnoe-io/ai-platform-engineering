"""Model for Registerguardrailrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Registerguardrailrequest(BaseModel):
  """Request body for POST /guardrails/register. Follows Generic Guardrail API config."""


class RegisterguardrailrequestResponse(APIResponse):
  """Response model for Registerguardrailrequest"""

  data: Optional[Registerguardrailrequest] = None


class RegisterguardrailrequestListResponse(APIResponse):
  """List response model for Registerguardrailrequest"""

  data: List[Registerguardrailrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
