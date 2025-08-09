"""Model for Workspacerequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workspacerequest(BaseModel):
    """Workspacerequest model"""


class WorkspacerequestResponse(APIResponse):
    """Response model for Workspacerequest"""

    data: Optional[Workspacerequest] = None


class WorkspacerequestListResponse(APIResponse):
    """List response model for Workspacerequest"""

    data: List[Workspacerequest] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
