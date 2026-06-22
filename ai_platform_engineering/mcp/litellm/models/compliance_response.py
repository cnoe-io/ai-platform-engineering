"""Model for Complianceresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Complianceresponse(BaseModel):
  """Response from a compliance check endpoint."""


class ComplianceresponseResponse(APIResponse):
  """Response model for Complianceresponse"""

  data: Optional[Complianceresponse] = None


class ComplianceresponseListResponse(APIResponse):
  """List response model for Complianceresponse"""

  data: List[Complianceresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
