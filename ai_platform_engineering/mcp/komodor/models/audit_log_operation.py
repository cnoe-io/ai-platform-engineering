"""Model for Auditlogoperation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Auditlogoperation(BaseModel):
  """Auditlogoperation model"""


class AuditlogoperationResponse(APIResponse):
  """Response model for Auditlogoperation"""

  data: Optional[Auditlogoperation] = None


class AuditlogoperationListResponse(APIResponse):
  """List response model for Auditlogoperation"""

  data: List[Auditlogoperation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
