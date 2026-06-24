"""Model for Auditlogcategory"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Auditlogcategory(BaseModel):
  """Auditlogcategory model"""


class AuditlogcategoryResponse(APIResponse):
  """Response model for Auditlogcategory"""

  data: Optional[Auditlogcategory] = None


class AuditlogcategoryListResponse(APIResponse):
  """List response model for Auditlogcategory"""

  data: List[Auditlogcategory] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
