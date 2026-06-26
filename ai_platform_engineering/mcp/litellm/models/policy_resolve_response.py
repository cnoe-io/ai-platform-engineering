"""Model for Policyresolveresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyresolveresponse(BaseModel):
  """Response for resolving effective policies/guardrails for a context."""


class PolicyresolveresponseResponse(APIResponse):
  """Response model for Policyresolveresponse"""

  data: Optional[Policyresolveresponse] = None


class PolicyresolveresponseListResponse(APIResponse):
  """List response model for Policyresolveresponse"""

  data: List[Policyresolveresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
