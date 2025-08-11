"""Model for Auditlogstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Auditlogstatus(BaseModel):
    """Auditlogstatus model"""


class AuditlogstatusResponse(APIResponse):
    """Response model for Auditlogstatus"""

    data: Optional[Auditlogstatus] = None


class AuditlogstatusListResponse(APIResponse):
    """List response model for Auditlogstatus"""

    data: List[Auditlogstatus] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
