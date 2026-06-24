"""Model for Policyconditionrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyconditionrequest(BaseModel):
  """Condition for when a policy applies."""


class PolicyconditionrequestResponse(APIResponse):
  """Response model for Policyconditionrequest"""

  data: Optional[Policyconditionrequest] = None


class PolicyconditionrequestListResponse(APIResponse):
  """List response model for Policyconditionrequest"""

  data: List[Policyconditionrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
