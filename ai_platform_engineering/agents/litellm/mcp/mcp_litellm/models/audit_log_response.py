"""Model for Auditlogresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Auditlogresponse(BaseModel):
  """Response model for a single audit log entry"""


class AuditlogresponseResponse(APIResponse):
  """Response model for Auditlogresponse"""

  data: Optional[Auditlogresponse] = None


class AuditlogresponseListResponse(APIResponse):
  """List response model for Auditlogresponse"""

  data: List[Auditlogresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
