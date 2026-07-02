"""Model for Auditlog"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Auditlog(BaseModel):
  """Auditlog model"""


class AuditlogResponse(APIResponse):
  """Response model for Auditlog"""

  data: Optional[Auditlog] = None


class AuditlogListResponse(APIResponse):
  """List response model for Auditlog"""

  data: List[Auditlog] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
