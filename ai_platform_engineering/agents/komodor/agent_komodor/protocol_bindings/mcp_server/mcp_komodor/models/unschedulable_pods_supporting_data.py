"""Model for Unschedulablepodssupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Unschedulablepodssupportingdata(BaseModel):
    """Unschedulablepodssupportingdata model"""


class UnschedulablepodssupportingdataResponse(APIResponse):
    """Response model for Unschedulablepodssupportingdata"""

    data: Optional[Unschedulablepodssupportingdata] = None


class UnschedulablepodssupportingdataListResponse(APIResponse):
    """List response model for Unschedulablepodssupportingdata"""

    data: List[Unschedulablepodssupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
