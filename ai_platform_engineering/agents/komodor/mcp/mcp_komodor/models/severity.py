"""Model for Severity"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Severity(BaseModel):
    """Severity model"""


class SeverityResponse(APIResponse):
    """Response model for Severity"""

    data: Optional[Severity] = None


class SeverityListResponse(APIResponse):
    """List response model for Severity"""

    data: List[Severity] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
