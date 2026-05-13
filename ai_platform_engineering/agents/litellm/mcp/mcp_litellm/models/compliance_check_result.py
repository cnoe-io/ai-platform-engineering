"""Model for Compliancecheckresult"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Compliancecheckresult(BaseModel):
  """Result of a single compliance check."""


class CompliancecheckresultResponse(APIResponse):
  """Response model for Compliancecheckresult"""

  data: Optional[Compliancecheckresult] = None


class CompliancecheckresultListResponse(APIResponse):
  """List response model for Compliancecheckresult"""

  data: List[Compliancecheckresult] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
