"""Model for Policycreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policycreaterequest(BaseModel):
  """Policycreaterequest model"""


class PolicycreaterequestResponse(APIResponse):
  """Response model for Policycreaterequest"""

  data: Optional[Policycreaterequest] = None


class PolicycreaterequestListResponse(APIResponse):
  """List response model for Policycreaterequest"""

  data: List[Policycreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
