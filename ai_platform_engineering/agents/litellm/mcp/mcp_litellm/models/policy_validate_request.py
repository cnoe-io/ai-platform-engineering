"""Model for Policyvalidaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyvalidaterequest(BaseModel):
  """Request body for the /policy/validate endpoint."""


class PolicyvalidaterequestResponse(APIResponse):
  """Response model for Policyvalidaterequest"""

  data: Optional[Policyvalidaterequest] = None


class PolicyvalidaterequestListResponse(APIResponse):
  """List response model for Policyvalidaterequest"""

  data: List[Policyvalidaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
