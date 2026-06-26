"""Model for Policyupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyupdaterequest(BaseModel):
  """Request body for updating a policy."""


class PolicyupdaterequestResponse(APIResponse):
  """Response model for Policyupdaterequest"""

  data: Optional[Policyupdaterequest] = None


class PolicyupdaterequestListResponse(APIResponse):
  """List response model for Policyupdaterequest"""

  data: List[Policyupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
