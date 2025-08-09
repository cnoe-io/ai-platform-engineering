"""Model for Unschedulablepodsdistribution"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Unschedulablepodsdistribution(BaseModel):
    """Unschedulablepodsdistribution model"""


class UnschedulablepodsdistributionResponse(APIResponse):
    """Response model for Unschedulablepodsdistribution"""

    data: Optional[Unschedulablepodsdistribution] = None


class UnschedulablepodsdistributionListResponse(APIResponse):
    """List response model for Unschedulablepodsdistribution"""

    data: List[Unschedulablepodsdistribution] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
