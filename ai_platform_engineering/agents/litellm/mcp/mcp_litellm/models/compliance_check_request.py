"""Model for Compliancecheckrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Compliancecheckrequest(BaseModel):
  """Request payload for compliance check endpoints.

  Mirrors the spend log fields needed for compliance evaluation."""


class CompliancecheckrequestResponse(APIResponse):
  """Response model for Compliancecheckrequest"""

  data: Optional[Compliancecheckrequest] = None


class CompliancecheckrequestListResponse(APIResponse):
  """List response model for Compliancecheckrequest"""

  data: List[Compliancecheckrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
