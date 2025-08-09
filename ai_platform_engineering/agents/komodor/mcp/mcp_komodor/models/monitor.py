"""Model for Monitor"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Monitor(BaseModel):
    """Monitor model"""


class MonitorResponse(APIResponse):
    """Response model for Monitor"""

    data: Optional[Monitor] = None


class MonitorListResponse(APIResponse):
    """List response model for Monitor"""

    data: List[Monitor] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
