"""Model for Policyversionstatusupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyversionstatusupdaterequest(BaseModel):
  """Request body for updating a policy version's status."""


class PolicyversionstatusupdaterequestResponse(APIResponse):
  """Response model for Policyversionstatusupdaterequest"""

  data: Optional[Policyversionstatusupdaterequest] = None


class PolicyversionstatusupdaterequestListResponse(APIResponse):
  """List response model for Policyversionstatusupdaterequest"""

  data: List[Policyversionstatusupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
