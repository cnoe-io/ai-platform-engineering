"""Model for Auditlogfilters"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Auditlogfilters(BaseModel):
  """Auditlogfilters model"""


class AuditlogfiltersResponse(APIResponse):
  """Response model for Auditlogfilters"""

  data: Optional[Auditlogfilters] = None


class AuditlogfiltersListResponse(APIResponse):
  """List response model for Auditlogfilters"""

  data: List[Auditlogfilters] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
